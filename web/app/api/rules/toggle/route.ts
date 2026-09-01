import { NextResponse } from 'next/server';
import { readState, writeState } from '@/lib/state';
import { validateParsedSpec } from '@/lib/parse';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? '');
  const state = readState();
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return NextResponse.json({ error: 'rule not found' }, { status: 404 });
  if (!rule.active) {
    try {
      rule.spec = { ...rule.spec, ...validateParsedSpec(rule.spec) };
    } catch (error: any) {
      return NextResponse.json(
        { error: error?.message ?? 'unsafe policy draft' },
        { status: 400 },
      );
    }
  }
  rule.active = !rule.active;
  state.events.push({
    ts: new Date().toISOString(),
    stage: rule.active ? 'rule-activated' : 'rule-paused',
    detail: `${rule.id}: ${rule.text}`,
  });
  writeState(state);
  return NextResponse.json({ rules: state.rules });
}
