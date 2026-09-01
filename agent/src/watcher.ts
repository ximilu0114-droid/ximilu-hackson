import { Log, getAddress, zeroPadValue } from 'ethers';
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
      const expectedPayee = getAddress(spec.payee ?? agentWalletAddr);
      const logs: Log[] = await sepolia.send('eth_getLogs', [
        {
          address: spec.token,
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            null,
            zeroPadValue(expectedPayee, 32),
          ],
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
        },
      ]);
      for (const l of logs.reverse()) {
        const amount = BigInt(l.data);
        const recipient = getAddress('0x' + l.topics[2].slice(26));
        if (amount < BigInt(spec.minAmount)) continue;
        if (recipient !== expectedPayee) continue;
        // Calldata is cross-checked before proof generation in processMatch.
        matches.push({ txHash: l.transactionHash, ruleId: rule.id, payee: recipient, amount });
      }
    } else {
      const expectedPayee = getAddress(spec.payee ?? agentWalletAddr);
      const nativeFrom = Math.max(from, to - CONFIG.nativeScanBlocks + 1);
      for (let height = nativeFrom; height <= to; ++height) {
        const block = await sepolia.send('eth_getBlockByNumber', [
          '0x' + height.toString(16),
          true,
        ]);
        for (const tx of block?.transactions ?? []) {
          if (!tx.to || getAddress(tx.to) !== expectedPayee) continue;
          const amount = BigInt(tx.value ?? 0);
          if (amount < BigInt(spec.minAmount)) continue;
          matches.push({
            txHash: tx.hash,
            ruleId: rule.id,
            payee: expectedPayee,
            amount,
          });
        }
      }
    }
  }

  state.lastHeight = to;
  return [...new Map(matches.map((m) => [`${m.ruleId}:${m.txHash}`, m])).values()];
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
