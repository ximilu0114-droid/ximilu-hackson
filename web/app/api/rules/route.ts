export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readState, writeState } from '@/lib/state';
import { parseRuleWithOptionalLlm } from '@/lib/llm';

export async function GET() {
  const state = readState();
  return NextResponse.json({ rules: state.rules });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'empty rule' }, { status: 400 });

  const state = readState();
  if (state.rules.find((r) => r.text === text)) {
    return NextResponse.json(
      { error: 'rule already exists', id: state.rules.find((r) => r.text === text)!.id },
      { status: 409 },
    );
  }
  let parsed: Awaited<ReturnType<typeof parseRuleWithOptionalLlm>>;
  try {
    parsed = await parseRuleWithOptionalLlm(text);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? 'invalid payment rule' },
      { status: 400 },
    );
  }
  const id = 'r' + (state.rules.length + 1);
  state.rules.push({
    id,
    text,
    engine: parsed.engine,
    // Natural-language compilation creates a reviewable draft. AI output never
    // becomes a money-moving policy until the user explicitly activates it.
    active: false,
    policyId: 0,
    spec: parsed.value,
    createdAt: new Date().toISOString(),
  });
  state.events.push({
    ts: new Date().toISOString(),
    stage: 'rule-added',
    detail: `${id} draft via ${parsed.engine}: ${text}`,
  });
  writeState(state);
  return NextResponse.json({ id, requiresActivation: true, rules: state.rules });
}
