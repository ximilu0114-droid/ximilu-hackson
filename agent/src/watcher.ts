import { Contract, Log } from 'ethers';
import { CONFIG } from './config.js';
import { AgentState, log } from './state.js';
import { decodeErc20Call, getProof, settleOnASC } from './prover.js';

export const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

export interface MatchResult {
  txHash: string;
  ruleId: string;
  payee: string;
  amount: bigint;
}

/** One scan pass over the attested window; returns matches against active rules. */
export async function scanOnce(
  sepolia: any,
  state: AgentState,
  rules: Array<{ id: string; spec: any }>,
  agentWalletAddr: string
): Promise<MatchResult[]> {
  if (rules.length === 0) return [];
  const top = await attestedHeightSafe();
  if (!top) return [];
  const from = Math.max(state.lastHeight + 1, top - CONFIG.scanBlocks);
  const to = top;
  if (from > to) return []; // already caught up — nothing new attested yet
  const matches: MatchResult[] = [];

  for (const rule of rules) {
    const spec = rule.spec;
    if (spec.token) {
      try {
        const logs: Log[] = await sepolia.send('eth_getLogs', [
          {
            address: spec.token,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            ],
            fromBlock: '0x' + from.toString(16),
            toBlock: '0x' + to.toString(16),
          },
        ]);
        for (const l of logs.reverse()) {
          const amount = BigInt(l.data);
          const recipient = '0x' + l.topics[2].slice(26);
          if (amount < spec.minAmount) continue;
          if (spec.payee && recipient.toLowerCase() !== spec.payee.toLowerCase()) continue;
          // verify underlying calldata is a transfer/transferFrom TO the recipient
          // (event-only matching would also catch transferFrom where msg.sender differs)
          matches.push({ txHash: l.transactionHash, ruleId: rule.id, payee: recipient, amount });
        }
      } catch (e: any) {
        log(`scan error (rule ${rule.id}): ${e.message?.slice(0, 120)}`);
      }
    }
  }

  state.lastHeight = to;
  return matches;
}

async function attestedHeightSafe(): Promise<number | null> {
  try {
    const res = await fetch(`${CONFIG.proverUrl}/api/v1/attested-height/${CONFIG.sepoliaChainKey}`);
    const j: any = await res.json();
    return Number(j.attestedHeight);
  } catch {
    return null;
  }
}
