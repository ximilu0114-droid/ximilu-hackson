import { JsonRpcProvider, Wallet, AbiCoder, Contract } from 'ethers';
import { proofProvider } from '@gluwa/usc-sdk';
import { CONFIG } from './config.js';
import { log } from './state.js';

export const ASC_ABI = [
  'event PaymentSettled(uint256 indexed policyId, bytes32 indexed sourceTxId, address payer, address token, uint256 amount, address beneficiary, uint256 releasedAmount, uint64 srcHeight, uint64 srcTxIndex)',
  'event MessagePublished(uint64 destChainKey, address destContract, bytes payload)',
  'function settle(uint256 policyId, uint64 chainKey, uint64 height, uint64 txIndex, bytes encodedTransaction, (bytes32,(bytes32,bool)[]) merkleProof, (bytes32,bytes32[]) continuityProof) external',
  'function previewTx(bytes) view returns ((address from,address to,bool toIsNull,uint256 value,bytes data,bool receiptStatus))',
  'function findPolicy(uint64 chainKey, address payee, address token) view returns (int256)',
  'function createPolicy(uint64 chainKey, address token, uint8 tokenDecimals, address payee, uint256 minAmount, address beneficiary, uint256 payoutRatioE18) returns (uint256)',
  'function setOperator(address operator, bool enabled) external',
  'function operators(address) view returns (bool)',
  'function escrowBalance() view returns (uint256)',
  'function owner() view returns (address)',
];

export async function makeClients() {
  const sepolia = new JsonRpcProvider(CONFIG.sepoliaRpc);
  const cc3 = new JsonRpcProvider(CONFIG.cc3Rpc);
  return { sepolia, cc3 };
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

/**
 * Find or create the ASC policy for a matched payment.
 * Returns policyId; agent wallet acts as owner/beneficiary in demo mode.
 */
export async function ensurePolicy(
  asc: Contract,
  signerAddress: string,
  spec: { token: string | null; minAmount: bigint; payoutRatioE18: bigint },
  payee: string
): Promise<number> {
  const token = spec.token ?? '0x0000000000000000000000000000000000000000';
  const existing = Number(await asc.findPolicy(CONFIG.sepoliaChainKey, payee, token));
  if (existing >= 0) return existing;
  const decimals = spec.token ? 6 : 18;
  const tx = await asc.createPolicy(
    CONFIG.sepoliaChainKey,
    token,
    decimals,
    payee,
    spec.minAmount,
    signerAddress,
    spec.payoutRatioE18,
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
): Promise<{ txHash: string; dry: boolean; rejected?: boolean }> {
  const tv = decodeTxBytes(proof.txBytes);
  // The precompile proves inclusion only; success is OUR responsibility.
  if (!tv.success) {
    log(`REJECT ${proof.txHash}: attested receipt status != 1 (failed source tx)`);
    return { txHash: '', dry: true, rejected: true };
  }

  if (!asc) {
    log(
      `DRY settle: sourceTx=${proof.txHash} status=${tv.success} to=${tv.to} dataLen=${tv.data.length} — live settle skipped (unfunded)`,
    );
    return { txHash: '', dry: true };
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
  log(`LIVE settle mined: ${rcpt.hash} gas=${rcpt.gasUsed?.toString()}`);
  return { txHash: rcpt.hash, dry: false };
}
