/**
 * Attestcoin batch-depth acceptance probe.
 *
 * Selects 2-10 already-attested Sepolia transactions, requests one shared
 * continuity proof with per-transaction Merkle proofs, checks each proof's
 * derived transaction index, and verifies the whole batch through CC3's
 * native BlockProver in one read-only call.
 *
 * Environment:
 *   TX_HASHES=0x...,0x...  optional explicit transaction list
 *   BATCH_SIZE=3           auto-selection size, 2..10
 *   SCAN_BLOCKS=100        attested blocks to inspect
 */
import 'dotenv/config';
import { JsonRpcProvider } from 'ethers';
import { blockProver, chainInfo, proofProvider } from '@gluwa/usc-sdk';

const SEPOLIA_RPC =
  process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const CTC_RPC =
  process.env.CREDITCOIN_TESTNET_RPC_URL ??
  'https://rpc.cc3-testnet.creditcoin.network';
const PROVER_URL =
  process.env.PROVER_URL ?? 'https://prover.cc3-testnet.creditcoin.network';

const SEPOLIA_CHAIN_ID = 11155111;
const MAX_BATCH_SIZE = 10;
const MAX_BATCH_SPAN = 1000;

async function retry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.log(`${label} attempt ${attempt} hit a transient error; retrying`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError;
}

function readBatchSize(): number {
  const value = Number(process.env.BATCH_SIZE ?? 3);
  if (!Number.isInteger(value) || value < 2 || value > MAX_BATCH_SIZE) {
    throw new Error(`BATCH_SIZE must be an integer from 2 to ${MAX_BATCH_SIZE}`);
  }
  return value;
}

async function selectTransactions(
  sepolia: JsonRpcProvider,
  attestedHeight: number,
): Promise<Array<{ hash: string; blockNumber: number }>> {
  const explicit = (process.env.TX_HASHES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (explicit.length > 0) {
    if (explicit.length < 2 || explicit.length > MAX_BATCH_SIZE) {
      throw new Error(`TX_HASHES must contain 2-${MAX_BATCH_SIZE} hashes`);
    }
    if (new Set(explicit.map((hash) => hash.toLowerCase())).size !== explicit.length) {
      throw new Error('TX_HASHES must not contain duplicates');
    }
    const transactions = await Promise.all(
      explicit.map(async (hash) => {
        const transaction = await sepolia.getTransaction(hash);
        if (!transaction || transaction.blockNumber == null) {
          throw new Error(`TX ${hash} not found or not yet mined`);
        }
        if (transaction.blockNumber > attestedHeight) {
          throw new Error(`TX ${hash} is above the latest attested height`);
        }
        return { hash: transaction.hash, blockNumber: transaction.blockNumber };
      }),
    );
    return transactions;
  }

  const targetSize = readBatchSize();
  const latestSourceHeight = Number(await sepolia.getBlockNumber());
  const top = Math.min(attestedHeight - 1, latestSourceHeight);
  const scanBlocks = Number(process.env.SCAN_BLOCKS ?? 100);
  if (!Number.isInteger(scanBlocks) || scanBlocks < 1 || scanBlocks > MAX_BATCH_SPAN) {
    throw new Error(`SCAN_BLOCKS must be an integer from 1 to ${MAX_BATCH_SPAN}`);
  }

  console.log(
    `[2] Auto-selecting ${targetSize} transactions from attested blocks ${top}..${Math.max(1, top - scanBlocks)}`,
  );
  const selected: Array<{ hash: string; blockNumber: number }> = [];
  for (let height = top; height > top - scanBlocks && height > 0; height--) {
    const block = await sepolia.getBlock(height, true);
    if (!block || block.transactions.length === 0) continue;
    // One transaction per block makes the shared continuity proof visibly
    // load-bearing instead of reducing the batch to one Merkle root.
    const item = block.transactions[0];
    const hash = typeof item === 'string' ? item : (item as { hash: string }).hash;
    selected.push({ hash, blockNumber: height });
    if (selected.length === targetSize) return selected;
  }
  throw new Error(`Found only ${selected.length}/${targetSize} transactions in scan window`);
}

async function main(): Promise<void> {
  const sepolia = new JsonRpcProvider(SEPOLIA_RPC);
  const cc = new JsonRpcProvider(CTC_RPC);
  const registry = new chainInfo.PrecompileChainInfoProvider(cc);
  const supported = await registry.getSupportedChains();
  const sepoliaInfo =
    supported.find((candidate) => Number(candidate.chainId) === SEPOLIA_CHAIN_ID) ??
    (await registry.getSupportedChainByKey(1));
  if (!sepoliaInfo) throw new Error('Sepolia is not supported as a source chain');
  const chainKey = sepoliaInfo.chainKey;
  const attested = await registry.getLatestAttestedHeightAndHash(chainKey);
  const attestedHeight = Number(attested.height);
  console.log(
    `[1] Sepolia chainId=${SEPOLIA_CHAIN_ID} resolves to chainKey=${chainKey}; latest attested height=${attestedHeight}`,
  );

  const selected = await selectTransactions(sepolia, attestedHeight);
  const heights = selected.map((transaction) => transaction.blockNumber);
  const span = Math.max(...heights) - Math.min(...heights);
  if (span > MAX_BATCH_SPAN) {
    throw new Error(`Batch spans ${span} blocks; protocol maximum is ${MAX_BATCH_SPAN}`);
  }
  console.log(
    `[2] Selected ${selected.length} transactions across ${span} blocks:\n${selected
      .map((transaction) => `    ${transaction.hash} @ ${transaction.blockNumber}`)
      .join('\n')}`,
  );

  const builder = new proofProvider.service.ProofBuilder(chainKey, PROVER_URL, 30_000);
  const batchResult = await retry('batch proof request', async () => {
    const candidate = await builder.getBatchProof(selected.map(({ hash }) => hash));
    if (!candidate.success || !candidate.data) {
      throw new Error(`Batch proof generation failed: ${candidate.error}`);
    }
    return candidate;
  });
  if (!batchResult.success || !batchResult.data) {
    throw new Error(`Batch proof generation failed: ${batchResult.error}`);
  }
  const proof = batchResult.data;
  if (proof.chainKey !== chainKey) throw new Error('Batch proof chainKey mismatch');
  if (proof.toHeader - proof.fromHeader > MAX_BATCH_SPAN) {
    throw new Error('Proof service returned an over-span batch');
  }

  const batchHeights: number[] = [];
  const encodedTransactions: string[] = [];
  const merkleProofs: Parameters<blockProver.PrecompileBlockProver['verifyBatch']>[3] = [];
  const proofEntries: Array<{ hash: string; blockNumber: number; transactionIndex: number }> = [];
  const prover = new blockProver.PrecompileBlockProver(cc);

  for (const [headerNumber, proofsByIndex] of proof.merkleProofs.entries()) {
    for (const [claimedIndex, entry] of proofsByIndex.entries()) {
      // SDK 0.18.0 declares `number`, while ethers v6 returns a runtime bigint.
      const derivedIndex = Number(await prover.computeTransactionIndex(entry.merkleProof));
      if (derivedIndex !== claimedIndex) {
        throw new Error(
          `Merkle-derived index ${derivedIndex} does not equal batch key ${claimedIndex}`,
        );
      }
      batchHeights.push(headerNumber);
      encodedTransactions.push(entry.txBytes);
      merkleProofs.push(entry.merkleProof);
      proofEntries.push({
        hash: entry.txHash,
        blockNumber: headerNumber,
        transactionIndex: derivedIndex,
      });
    }
  }

  const requestedHashes = new Set(selected.map(({ hash }) => hash.toLowerCase()));
  const returnedHashes = new Set(proofEntries.map(({ hash }) => hash.toLowerCase()));
  if (
    returnedHashes.size !== requestedHashes.size ||
    [...requestedHashes].some((hash) => !returnedHashes.has(hash))
  ) {
    throw new Error('Batch proof response does not exactly match requested transactions');
  }
  console.log(
    `[3] Shared proof covers headers ${proof.fromHeader}..${proof.toHeader}; ${proofEntries.length} Merkle indices independently matched`,
  );

  const verified = await prover.verifyBatch(
    proof.chainKey,
    batchHeights,
    encodedTransactions,
    merkleProofs,
    proof.continuityProof,
  );
  const summary = {
    step: 'e2e-batch-proof',
    sourceChain: 'Ethereum Sepolia',
    chainKey: proof.chainKey,
    proofRange: { from: proof.fromHeader, to: proof.toHeader },
    transactionCount: proofEntries.length,
    transactions: proofEntries,
    sharedContinuityProof: true,
    verification: verified ? 'SUCCESS' : 'FAILED',
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!verified) process.exit(1);
}

main().catch((error) => {
  console.error('E2E BATCH PROOF FAILED:', error);
  process.exit(1);
});
