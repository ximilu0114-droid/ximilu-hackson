import { JsonRpcProvider, Wallet, AbiCoder, Contract, getAddress, solidityPackedKeccak256 } from 'ethers';
import { blockProver, chainInfo, proofProvider } from '@gluwa/usc-sdk';
import { CONFIG } from './config.js';
import { log } from './state.js';

export const ASC_ABI = [
  'event PaymentSettled(uint256 indexed policyId, bytes32 indexed sourceTxId, address indexed payer, address token, uint256 amount, address beneficiary, uint256 releasedAmount, uint64 srcHeight, uint64 srcTxIndex)',
  'event MessagePublished(uint64 destChainKey, address destContract, bytes payload)',
  'function settle(uint256 policyId, uint64 chainKey, uint64 height, uint64 txIndex, bytes encodedTransaction, (bytes32,(bytes32,bool)[]) merkleProof, (bytes32,bytes32[]) continuityProof) external',
  'function previewTx(bytes) view returns ((address from,address to,bool toIsNull,uint256 value,bytes data,bool receiptStatus))',
  'function findPolicy(uint64 chainKey, address payee, address token) view returns (int256)',
  'function getPolicy(uint256 policyId) view returns ((uint64 chainKey,address token,uint8 tokenDecimals,address payee,uint256 minAmount,address beneficiary,uint64 destChainKey,address destContract,uint256 payoutRatioE18,bool active))',
  'function createPolicy(uint64 chainKey, address token, uint8 tokenDecimals, address payee, uint256 minAmount, address beneficiary, uint64 destChainKey, address destContract, uint256 payoutRatioE18) returns (uint256)',
  'function setOperator(address operator, bool enabled) external',
  'function operators(address) view returns (bool)',
  'function settledTxs(bytes32) view returns (bool)',
  'function escrowBalance() view returns (uint256)',
  'function owner() view returns (address)',
];

export async function makeClients() {
  const sepolia = new JsonRpcProvider(CONFIG.sepoliaRpc);
  const cc3 = new JsonRpcProvider(CONFIG.cc3Rpc);
  return { sepolia, cc3 };
}

/**
 * Fail closed if the CC3 ChainInfo registry no longer maps our configured
 * source to Ethereum Sepolia. chainKey is a protocol identifier, not an EVM
 * chain id, so silently assuming the mapping would be unsafe.
 */
export async function assertSepoliaRegistry(cc3: JsonRpcProvider): Promise<void> {
  const registry = new chainInfo.PrecompileChainInfoProvider(cc3);
  const supported = await registry.getSupportedChains();
  const sepolia = supported.find((entry) => Number(entry.chainId) === 11155111);
  if (!sepolia) throw new Error('CHAININFO_SEPOLIA_NOT_SUPPORTED');
  if (Number(sepolia.chainKey) !== CONFIG.sepoliaChainKey) {
    throw new Error(
      `CHAININFO_MAPPING_CHANGED: expected=${CONFIG.sepoliaChainKey} actual=${sepolia.chainKey}`,
    );
  }
  log(
    `ChainInfo verified: Sepolia chainId=11155111 chainKey=${sepolia.chainKey} encoding=${sepolia.chainEncoding}`,
  );
}

export function agentWallet(provider: any): Wallet {
  if (!CONFIG.privateKey) throw new Error('AGENT_PRIVATE_KEY missing in .env');
  return new Wallet(CONFIG.privateKey, provider);
}

/** Latest Sepolia height attested on CC3 (prover REST, no on-chain call). */
export async function attestedHeight(): Promise<number> {
  const res = await fetch(`${CONFIG.proverUrl}/api/v1/attested-height/${CONFIG.sepoliaChainKey}`);
  const j: any = await res.json();
  return Number(j.attestedHeight);
}

export async function getProof(txHash: string) {
  const builder = new proofProvider.service.ProofBuilder(CONFIG.sepoliaChainKey, CONFIG.proverUrl, 10_000);
  const res = await builder.getProof(txHash);
  if (!res.success || !res.data) throw new Error('proof failed: ' + res.error);
  return res.data;
}

/**
 * Backlog safety gate: prove 2-10 matched transactions with one shared
 * continuity proof before any item in that batch enters the settlement path.
 * A failed batch is retried on the next scan pass; it never degrades to an
 * unverified or partially accepted batch.
 */
export async function preflightBatchProof(
  txHashes: string[],
  cc3: JsonRpcProvider,
): Promise<{ count: number; fromHeader: number; toHeader: number }> {
  if (txHashes.length < 2 || txHashes.length > 10) {
    throw new Error('BATCH_PREFLIGHT_SIZE_MUST_BE_2_TO_10');
  }
  const requested = new Set(txHashes.map((hash) => hash.toLowerCase()));
  if (requested.size !== txHashes.length) {
    throw new Error('BATCH_PREFLIGHT_DUPLICATE_TX');
  }

  const builder = new proofProvider.service.ProofBuilder(
    CONFIG.sepoliaChainKey,
    CONFIG.proverUrl,
    30_000,
  );
  const result = await builder.getBatchProof(txHashes);
  if (!result.success || !result.data) {
    throw new Error(`BATCH_PROOF_FAILED:${result.error}`);
  }
  const proof = result.data;
  if (Number(proof.chainKey) !== CONFIG.sepoliaChainKey) {
    throw new Error('BATCH_PROOF_CHAINKEY_MISMATCH');
  }
  if (Number(proof.toHeader) - Number(proof.fromHeader) > 1000) {
    throw new Error('BATCH_PROOF_BLOCK_SPAN_EXCEEDED');
  }

  const heights: number[] = [];
  const txBytes: string[] = [];
  const merkleProofs: any[] = [];
  const returned = new Set<string>();
  for (const [headerNumber, proofsByIndex] of proof.merkleProofs.entries()) {
    for (const [claimedIndex, entry] of proofsByIndex.entries()) {
      const derivedIndex = computeTransactionIndex(entry.merkleProof);
      if (derivedIndex !== BigInt(claimedIndex)) {
        throw new Error('BATCH_PROOF_TX_INDEX_MISMATCH');
      }
      const hash = entry.txHash.toLowerCase();
      if (!requested.has(hash) || returned.has(hash)) {
        throw new Error('BATCH_PROOF_MEMBERSHIP_MISMATCH');
      }
      returned.add(hash);
      heights.push(Number(headerNumber));
      txBytes.push(entry.txBytes);
      merkleProofs.push(entry.merkleProof);
    }
  }
  if (
    returned.size !== requested.size ||
    [...requested].some((hash) => !returned.has(hash))
  ) {
    throw new Error('BATCH_PROOF_MEMBERSHIP_MISMATCH');
  }

  const prover = new blockProver.PrecompileBlockProver(cc3);
  const verified = await prover.verifyBatch(
    proof.chainKey,
    heights,
    txBytes,
    merkleProofs,
    proof.continuityProof,
  );
  if (!verified) throw new Error('BATCH_PROOF_PRECOMPILE_REJECTED');
  log(
    `batch preflight verified: count=${returned.size} headers=${proof.fromHeader}..${proof.toHeader}`,
  );
  return {
    count: returned.size,
    fromHeader: Number(proof.fromHeader),
    toHeader: Number(proof.toHeader),
  };
}

export interface TxViewTs {
  from: string;
  to: string;
  toIsNull: boolean;
  value: bigint;
  data: string;
  success: boolean;
}

/** TS mirror of AttestFlowASC._decodeTx — cross-checks SDK byte layout off-chain. */
export function decodeTxBytes(txBytes: string): TxViewTs {
  const coder = AbiCoder.defaultAbiCoder();
  const [, chunks] = coder.decode(['uint8', 'bytes[]'], txBytes) as unknown as [number, string[]];
  const common = coder.decode(
    ['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes'],
    chunks[0],
  ) as any;
  const receipt = coder.decode(
    ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes'],
    chunks[chunks.length - 1],
  ) as any;
  return {
    from: common[2],
    to: common[4],
    toIsNull: common[3],
    value: common[5],
    data: common[6],
    success: Number(receipt[0]) === 1,
  };
}

/** Extract ERC20 transfer/transferFrom recipient+amount from calldata, or null for native. */
export function decodeErc20Call(data: string): { recipient: string; amount: bigint } | null {
  const sel = data.slice(0, 10).toLowerCase();
  const body = '0x' + data.slice(10);
  const coder = AbiCoder.defaultAbiCoder();
  try {
    if (sel === '0xa9059cbb') {
      const [recipient, amount] = coder.decode(['address', 'uint256'], body) as any;
      return { recipient, amount };
    }
    if (sel === '0x23b872dd') {
      const [, recipient, amount] = coder.decode(['address', 'address', 'uint256'], body) as any;
      return { recipient, amount };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/** Derive the transaction index encoded by Merkle-path left/right bits. */
export function computeTransactionIndex(merkleProof: {
  siblings?: Array<{ isLeft: boolean }>;
}): bigint {
  const siblings = merkleProof.siblings ?? [];
  if (siblings.length > 64) throw new Error('Merkle proof is deeper than uint64');
  return siblings.reduce(
    (index, sibling, level) =>
      sibling.isLeft ? index | (1n << BigInt(level)) : index,
    0n,
  );
}

export function sourceTransactionId(
  chainKey: bigint | number,
  height: bigint | number,
  txIndex: bigint | number,
): string {
  return solidityPackedKeccak256(
    ['uint64', 'uint64', 'uint64'],
    [chainKey, height, txIndex],
  );
}

/**
 * Find or create the ASC policy for a matched payment.
 * Returns policyId; agent wallet acts as owner/beneficiary in demo mode.
 */
export async function ensurePolicy(
  asc: Contract,
  signerAddress: string,
  spec: {
    token: string | null;
    minAmount: bigint | string;
    payoutRatioE18: bigint | string;
  },
  payee: string,
  destContract: string,
): Promise<number> {
  const token = spec.token ?? '0x0000000000000000000000000000000000000000';
  const minAmount = BigInt(spec.minAmount);
  const payoutRatioE18 = BigInt(spec.payoutRatioE18);
  const existing = Number(await asc.findPolicy(CONFIG.sepoliaChainKey, payee, token));
  const decimals = spec.token ? 6 : 18;
  if (existing >= 0) {
    const policy: any = await asc.getPolicy(existing);
    const matches =
      BigInt(policy.chainKey) === BigInt(CONFIG.sepoliaChainKey) &&
      getAddress(policy.token) === getAddress(token) &&
      Number(policy.tokenDecimals) === decimals &&
      getAddress(policy.payee) === getAddress(payee) &&
      BigInt(policy.minAmount) === minAmount &&
      getAddress(policy.beneficiary) === getAddress(signerAddress) &&
      BigInt(policy.destChainKey) === BigInt(CONFIG.sepoliaChainKey) &&
      getAddress(policy.destContract) === getAddress(destContract) &&
      BigInt(policy.payoutRatioE18) === payoutRatioE18 &&
      Boolean(policy.active);
    if (!matches) throw new Error('EXISTING_POLICY_DOES_NOT_MATCH_RULE');
    return existing;
  }
  const tx = await asc.createPolicy(
    CONFIG.sepoliaChainKey,
    token,
    decimals,
    payee,
    minAmount,
    signerAddress,
    CONFIG.sepoliaChainKey,
    destContract,
    payoutRatioE18,
  );
  await tx.wait();
  log(`policy created on ASC for payee ${payee}`);
  return Number(await asc.findPolicy(CONFIG.sepoliaChainKey, payee, token));
}

/**
 * Settle on ASC.
 * - LIVE (LIVE=1 + ASC_ADDRESS + funded key): real on-chain verification via
 *   precompile verify() + escrow release.
 * - DRY (default): local decode validation only — no gas needed.
 * Both paths enforce source-tx success status before settling.
 */
export async function settleOnASC(
  asc: Contract | null,
  policyId: number,
  proof: any
): Promise<{
  txHash: string;
  dry: boolean;
  sourceTxId: string;
  messagePayload?: string;
  rejected?: boolean;
}> {
  const tv = decodeTxBytes(proof.txBytes);
  const proofTxIndex = computeTransactionIndex(proof.merkleProof);
  if (proofTxIndex !== BigInt(proof.txIndex)) {
    throw new Error(
      `proof txIndex mismatch: service=${proof.txIndex} merkle=${proofTxIndex}`,
    );
  }
  const sourceTxId = sourceTransactionId(
    proof.chainKey,
    proof.headerNumber,
    proofTxIndex,
  );
  // The precompile proves inclusion only; success is OUR responsibility.
  if (!tv.success) {
    log(`REJECT ${proof.txHash}: attested receipt status != 1 (failed source tx)`);
    return { txHash: '', dry: true, sourceTxId, rejected: true };
  }

  if (!asc) {
    log(
      `DRY settle: sourceTx=${proof.txHash} status=${tv.success} to=${tv.to} dataLen=${tv.data.length} — live settle skipped (unfunded)`,
    );
    return { txHash: '', dry: true, sourceTxId };
  }

  const extractPublishedPayload = async (
    receipt: any,
  ): Promise<{ messagePayload: string; emittedSourceTxId: string }> => {
    let messagePayload: string | undefined;
    let emittedSourceTxId: string | undefined;
    for (const eventLog of receipt.logs) {
      try {
        const parsed = asc.interface.parseLog(eventLog);
        if (parsed?.name === 'MessagePublished') {
          messagePayload = parsed.args.payload;
        }
        if (parsed?.name === 'PaymentSettled') {
          emittedSourceTxId = parsed.args.sourceTxId;
        }
      } catch {
        // Receipt may include unrelated precompile/system logs.
      }
    }
    if (!messagePayload) throw new Error('settlement receipt missing MessagePublished');
    if (emittedSourceTxId?.toLowerCase() !== sourceTxId.toLowerCase()) {
      throw new Error('PaymentSettled sourceTxId does not match verified proof');
    }
    return { messagePayload, emittedSourceTxId };
  };

  // Crash/retry path: the settlement may already be final on CC3 while the
  // destination delivery or local state checkpoint timed out. Recover the
  // exact published payload instead of trying to settle the proof again.
  if (await asc.settledTxs(sourceTxId)) {
    const provider: any = asc.runner?.provider;
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - CONFIG.recoveryBlockWindow);
    const logs = await asc.queryFilter(
      asc.filters.PaymentSettled(BigInt(policyId), sourceTxId),
      fromBlock,
      'latest',
    );
    const settlementLog: any = logs.at(-1);
    if (!settlementLog) throw new Error('settled source has no PaymentSettled log');
    const receipt = await provider.getTransactionReceipt(settlementLog.transactionHash);
    const { messagePayload } = await extractPublishedPayload(receipt);
    log(`RECOVER settlement receipt: ${settlementLog.transactionHash}`);
    return {
      txHash: settlementLog.transactionHash,
      dry: false,
      sourceTxId,
      messagePayload,
    };
  }
  const tx = await asc.settle(
    policyId,
    proof.chainKey,
    proof.headerNumber,
    proof.txIndex,
    proof.txBytes,
    // tuples as positional arrays (SDK returns objects; ABI components are unnamed)
    [proof.merkleProof.root, (proof.merkleProof.siblings ?? []).map((s: any) => [s.hash, s.isLeft])],
    [proof.continuityProof.lowerEndpointDigest, proof.continuityProof.roots],
  );
  const rcpt = await tx.wait();
  const { messagePayload } = await extractPublishedPayload(rcpt);
  log(`LIVE settle mined: ${rcpt.hash} gas=${rcpt.gasUsed?.toString()}`);
  return { txHash: rcpt.hash, dry: false, sourceTxId, messagePayload };
}
