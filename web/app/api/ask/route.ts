import { NextResponse } from 'next/server';
import { readState } from '@/lib/state';
import { answerHistoryWithOptionalLlm } from '@/lib/llm';

/**
 * NL Q&A over settlement history.
 * Deterministic by default; uses a disclosed OpenAI-compatible endpoint when
 * configured and falls back without changing any settlement state.
 */
export async function POST(req: Request) {
  const { question } = await req.json().catch(() => ({ question: '' }));
  const q = String(question ?? '').toLowerCase();
  const state = readState();

  const settledCount = Object.values(state.settledTx).filter(
    (v) => /^0x[0-9a-fA-F]{64}$/.test(String(v)) || String(v).startsWith('dry@') || String(v) === 'already-settled',
  ).length;
  const rejectedCount = Object.values(state.settledTx).filter((v) => String(v).startsWith('rejected') || String(v).startsWith('error:')).length;

  // sum of matched amounts × ratio (from events, base units → display)
  const amounts = state.events.filter((e) => e.stage === 'match').map((e) => Number(e.detail?.split('=')[1] ?? 0));
  const primaryRule = state.rules[0];
  const asset = primaryRule ? (primaryRule.spec.token ? 'USDC' : 'ETH') : 'USDC';
  const decimals = primaryRule?.spec.token === null ? 18 : 6;
  const totalAmount = amounts.reduce((a, b) => a + b, 0) / 10 ** decimals;
  const ratioPct =
    primaryRule ? Number(BigInt(primaryRule.spec.payoutRatioE18) * 10000n / 10n ** 18n) / 100 : 10;

  let answer: string;
  if (/多少笔|几笔|how many|count/.test(q)) {
    answer = `已结算 ${settledCount} 笔（其中被安全拒绝 ${rejectedCount} 笔），共注册 ${state.rules.length} 条规则，当前扫描至 Sepolia 区块 ${state.lastHeight}。`;
  } else if (/释放|金额|总额|released|total|amount/.test(q)) {
    answer = `按首条规则口径，匹配到的源链支付合计约 ${totalAmount.toFixed(asset === 'ETH' ? 4 : 2)} ${asset}；按 ${ratioPct}% 比例，累计应释放 ≈ ${((totalAmount * ratioPct) / 100).toFixed(6)} CTC。`;
  } else if (/最近|最新|recent|last/.test(q)) {
    const last = state.events.slice(-6).reverse().map((e) => `[${e.ts.slice(11, 19)}] ${e.stage}${e.tx ? ' ' + e.tx.slice(0, 12) + '…' : ''}`).join('\n');
    answer = `最近事件：\n${last}`;
  } else if (/规则|rule/.test(q)) {
    answer = state.rules.length
      ? state.rules.map((r) => `${r.id}${r.active ? ' ✅' : ' ⏸'} ${r.text}`).join('\n')
      : '暂无规则。';
  } else {
    answer = `概览：规则 ${state.rules.length} 条｜已结算 ${settledCount} 笔｜拒绝 ${rejectedCount} 笔｜首条规则口径匹配金额 ≈ ${totalAmount.toFixed(asset === 'ETH' ? 4 : 2)} ${asset}｜扫描高度 ${state.lastHeight}。可问“多少笔/释放了多少/最近事件/有哪些规则”。`;
  }

  const llmAnswer = await answerHistoryWithOptionalLlm(question, {
    lastHeight: state.lastHeight,
    rules: state.rules.map(({ id, text, engine, active, spec }) => ({
      id,
      text,
      engine,
      active,
      spec,
    })),
    settledTx: state.settledTx,
    deliveries: state.deliveries,
    recentEvents: state.events.slice(-40),
  });
  if (llmAnswer) {
    return NextResponse.json({ answer: llmAnswer, engine: 'llm' });
  }
  return NextResponse.json({ answer, engine: 'builtin' });
}
