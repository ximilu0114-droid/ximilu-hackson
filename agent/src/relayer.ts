/**
 * Writability adapter (outbound leg).
 *
 * The protocol's official Outbox/Inbox contracts are NOT yet deployed on
 * CC3 testnet (docs: writability "undergoing 3rd party testing and audits").
 * This module implements the SAME four-step semantics so the demo closes the
 * loop today and can swap in the official contracts later:
 *   1 publish  — AttestFlowASC emits MessagePublished(destChainKey, dest, payload)
 *   2 sign     — relayer signs keccak(payload) with its operator key
 *                (stands in for attestor quorum; swap for official Inbox validation)
 *   3 deliver  — relayer submits (payload, signature) to InboxDemo on Sepolia
 *   4 validate — InboxDemo recovers the signer, checks authorization, executes
 *
 * In DRY mode delivery is simulated with a local signature + log evidence.
 */
import { Contract, Wallet } from 'ethers';
import { CONFIG } from './config.js';
import { log } from './state.js';

export const INBOX_ABI = [
  'event MessageExecuted(bytes32 indexed payloadHash, address indexed executor, uint256 policyId, uint256 released)',
  'function execute(bytes payload, bytes signature) external',
  'function executedPayloads(bytes32) view returns (bool)',
];

export async function deliverMessage(
  payload: string,
  signer: Wallet,
  inbox: Contract | null
): Promise<{ txHash: string; dry: boolean }> {
  const ethers = await import('ethers');
  const payloadHash = ethers.keccak256(payload);
  // Inbox validates keccak256("\x19Ethereum Signed Message:\n32" ++ payloadHash),
  // so sign the 32-byte digest (signMessage(bytesLike) applies EIP-191 itself).
  const sig = await signer.signMessage(ethers.getBytes(payloadHash));

  if (!CONFIG.liveMode || !CONFIG.inboxAddress || !inbox) {
    log(`DRY deliver: payloadHash=${payloadHash} sig=${sig.slice(0, 20)}... — live Inbox delivery skipped (unfunded)`);
    return { txHash: '', dry: true };
  }

  if (await inbox.executedPayloads(payloadHash)) {
    const provider: any = inbox.runner?.provider;
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - CONFIG.recoveryBlockWindow);
    const logs = await inbox.queryFilter(
      inbox.filters.MessageExecuted(payloadHash),
      fromBlock,
      'latest',
    );
    const existing: any = logs.at(-1);
    const txHash = existing?.transactionHash ?? '';
    log(`RECOVER destination execution: ${txHash || payloadHash}`);
    return { txHash, dry: false };
  }
  const tx = await (inbox as any).connect(signer).execute(payload, sig);
  const rcpt = await tx.wait();
  log(`LIVE delivered to Sepolia Inbox: ${rcpt.hash}`);
  return { txHash: rcpt.hash, dry: false };
}
