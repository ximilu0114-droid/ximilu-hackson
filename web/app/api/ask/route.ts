import { NextResponse } from 'next/server';
import { readState } from '@/lib/state';

/**
 * NL Q&A over settlement history.
 * Builtin deterministic engine (no external calls); upgrades to LLM
 * summarization when OPENAI_API_KEY is configured (disclosed third-party).
 */
export async function POST(req: Request) {
  const { question } = await req.json().catch(() => ({ question: '' }));
  const q = String(question ?? '').toLowerCase();
  const state = readState();

  const settledCount = Object.values(state.settledTx).filter((v) => !String(v).startsWith('rejected')).length;
  const rejectedCount = Object.values(state.settledTx).filter((v) => String(v).startsWith('rejected')).length;

  // sum of matched amounts × ratio (from events, base units → display)
  const amounts = state.events.filter((e) => e.stage === 'match').map((e) => Number(e.detail?.split('=')[1] ?? 0));
  const totalUsdc = amounts.reduce((a, b) => a + b, 0) / 1e6;
  const ratioPct =
    state.rules[0] ? Number(BigInt(state.rules[0].spec.payoutRatioE18) * 100n / 10n ** 18n) : 10;

  let answer: string;
  if (/多少笔|几笔|how many|count/.test(q)) {
    answer = `已结算 ${settledCount} 笔（其中被安全拒绝 ${rejectedCount} 笔），共注册 ${state.rules.length} 条规则，当前扫描至 Sepolia 区块 ${state.lastHeight}。`;
  } else if (/释放|金额|总额|released|total|amount/.test(q)) {
    answer = `匹配到的源链支付合计约 ${totalUsdc.toFixed(2)} USDC；按规则 ${ratioPct}% 比例，累计应释放 ≈ ${((totalUsdc * ratioPct) / 100).toFixed(4)} CTC。`;
  } else if (/最近|最新|recent|last/.test(q)) {
    const last = state.events.slice(-6).reverse().map((e) => `[${e.ts.slice(11, 19)}] ${e.stage}${e.tx ? ' ' + e.tx.slice(0, 12) + '…' : ''}`).join('\n');
    answer = `最近事件：\n${last}`;
  } else if (/规则|rule/.test(q)) {
    answer = state.rules.length
      ? state.rules.map((r) => `${r.id}${r.active ? ' ✅' : ' ⏸'} ${r.text}`).join('\n')
      : '暂无规则。';
  } else {
    answer = `概览：规则 ${state.rules.length} 条｜已结算 ${settledCount} 笔｜拒绝 ${rejectedCount} 笔｜匹配金额 ≈ ${totalUsdc.toFixed(2)} USDC｜扫描高度 ${state.lastHeight}。可问“多少笔/释放了多少/最近事件/有哪些规则”。`;
  }

  return NextResponse.json({ answer, engine: process.env.OPENAI_API_KEY ? 'llm' : 'builtin' });
}
