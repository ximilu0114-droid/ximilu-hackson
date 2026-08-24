export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readState, AgentEvent } from '@/lib/state';

const ORDER = ['match', 'proved', 'settled', 'rejected', 'delivered'] as const;

export interface Pipeline {
  tx: string;
  stages: Record<string, AgentEvent>;
  current: string;
}

export async function GET() {
  const state = readState();
  const live = !!process.env.LIVE || Object.values(state.settledTx).some((v) => /^0x[0-9a-fA-F]{64}$/.test(String(v)));
  const byTx = new Map<string, Pipeline>();
  for (const e of state.events) {
    if (!e.tx || !ORDER.includes(e.stage as any)) continue;
    let p = byTx.get(e.tx);
    if (!p) {
      p = { tx: e.tx, stages: {}, current: 'match' };
      byTx.set(e.tx, p);
    }
    p.stages[e.stage] = e;
  }
  for (const p of byTx.values()) {
    for (const s of [...ORDER].reverse()) {
      if (p.stages[s]) {
        p.current = s;
        break;
      }
    }
  }
  const pipelines = [...byTx.values()].sort((a, b) => {
    const ta = a.stages.match?.ts ?? '';
    const tb = b.stages.match?.ts ?? '';
    return tb.localeCompare(ta);
  });

  const settled = Object.entries(state.settledTx).filter(([, v]) => !String(v).startsWith('rejected'));
  return NextResponse.json({
    lastHeight: state.lastHeight,
    live,
    stats: {
      rules: state.rules.length,
      settled: pipelines.filter((p) => p.current === 'settled' || p.current === 'delivered').length,
      rejected: pipelines.filter((p) => p.current === 'rejected').length,
      deliveries: Object.keys(state.deliveries).length,
    },
    pipelines: pipelines.slice(0, 30),
  });
}
