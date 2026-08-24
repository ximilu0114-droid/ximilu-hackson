/**
 * Phase 0 acceptance: prove a real Ethereum Sepolia transaction on Creditcoin CC3 Testnet.
 *
 * - Resolves Sepolia's chainKey from the on-chain ChainInfo precompile
 * - Picks a real confirmed tx (env TX_HASH overrides; otherwise scans an
 *   already-attested window so no waiting is needed)
 * - Generates an inclusion proof via the hosted prover service
 * - Verifies it on-chain via the BlockProver precompile (read-only verifySingle)
 *
 * Exit code 0 = SUCCESS, non-zero = FAILED.
 */
import 'dotenv/config';
import { JsonRpcProvider } from 'ethers';
import { chainInfo, blockProver, proofProvider } from '@gluwa/usc-sdk';

const SEPOLIA_RPC =
  process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const CTC_RPC =
  process.env.CREDITCOIN_TESTNET_RPC_URL ??
  'https://rpc.cc3-testnet.creditcoin.network';
const PROVER_URL =
  process.env.PROVER_URL ?? 'https://prover.cc3-testnet.creditcoin.network';

const SEPOLIA_CHAIN_ID = 11155111;
const POLL_MS = 15_000;
const WAIT_TIMEOUT_MS = 15 * 60_000;

async function main(): Promise<void> {
  const sepolia = new JsonRpcProvider(SEPOLIA_RPC);
  const cc = new JsonRpcProvider(CTC_RPC);

  // [1] Discover supported source chains and Sepolia's chainKey (not its EVM chainId)
  const info = new chainInfo.PrecompileChainInfoProvider(cc);
  const chains = await info.getSupportedChains();
  console.log(
    `[1] Supported source chains: ${chains
      .map((c) => `${c.chainName} (chainKey=${c.chainKey}, chainId=${c.chainId})`)
      .join(', ')}`,
  );
  const sepoliaInfo =
    chains.find((c) => Number(c.chainId) === SEPOLIA_CHAIN_ID) ??
    (await info.getSupportedChainByKey(1));
  if (!sepoliaInfo) throw new Error('Sepolia is not supported as a source chain');
  const chainKey = sepoliaInfo.chainKey;
  console.log(`[1] Using chainKey=${chainKey} for Ethereum Sepolia`);

  // [2] Resolve target transaction
  let txHash: string | undefined = process.env.TX_HASH;
  let blockNumber = 0;

  if (txHash) {
    const tx = await sepolia.getTransaction(txHash);
    if (!tx || tx.blockNumber == null)
      throw new Error(`TX ${txHash} not found or not yet mined`);
    blockNumber = tx.blockNumber;
  } else {
    // Scan backwards from the latest attested height for any real tx:
    // guarantees the proof can be generated immediately.
    const attested = await info.getLatestAttestedHeightAndHash(chainKey);
    const top = Math.min(
      Number(attested.height) - 1,
      Number(await sepolia.getBlockNumber()),
    );
    const scan = Number(process.env.SCAN_BLOCKS ?? 60);
    console.log(
      `[2] Latest attested Sepolia height on CC3 testnet: ${attested.height}; scanning blocks ${top}..${top - scan}`,
    );
    let found: string | null = null;
    for (let h = top; h > top - scan && h > 0; h--) {
      const block = await sepolia.getBlock(h, true);
      if (!block || block.transactions.length === 0) continue;
      const t0: unknown = block.transactions[0];
      found = typeof t0 === 'string' ? t0 : (t0 as { hash: string }).hash;
      blockNumber = h;
      break;
    }
    if (!found) throw new Error('No transaction found in scan window');
    txHash = found;
  }
  console.log(`[2] Target tx: ${txHash} (block ${blockNumber})`);

  // [3] Generate inclusion proof via hosted prover service
  const builder = new proofProvider.service.ProofBuilder(chainKey, PROVER_URL, 10_000);
  process.stdout.write('[3] Waiting for attestation... ');
  await builder.waitUntilHeightAttested(chainKey, blockNumber, POLL_MS, WAIT_TIMEOUT_MS);
  console.log('attested.');
  const result = await builder.getProof(txHash);
  if (!result.success || !result.data) {
    throw new Error(`Proof generation failed: ${result.error}`);
  }
  const proof = result.data;
  console.log(
    `[3] Proof generated (cached=${proof.cached}, block=${proof.headerNumber}, txIndex=${proof.txIndex})`,
  );

  // [4] Verify on-chain via precompile 0x0FD2 (read-only eth_call, no gas needed)
  const prover = new blockProver.PrecompileBlockProver(cc);
  const verified = await prover.verifySingle(
    proof.chainKey,
    Number(proof.headerNumber),
    proof.txBytes,
    proof.merkleProof,
    proof.continuityProof,
  );

  const summary = {
    step: 'e2e-proof',
    sourceChain: 'Ethereum Sepolia',
    chainKey: proof.chainKey,
    txHash: proof.txHash,
    blockNumber: Number(proof.headerNumber),
    verification: verified ? 'SUCCESS' : 'FAILED',
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!verified) process.exit(1);
}

main().catch((err) => {
  console.error('E2E PROOF FAILED:', err);
  process.exit(1);
});
