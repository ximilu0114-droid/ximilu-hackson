import { NextResponse } from 'next/server';
import { readState, writeState } from '@/lib/state';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? '');
  const state = readState();
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return NextResponse.json({ error: 'rule not found' }, { status: 404 });
  rule.active = !rule.active;
  writeState(state);
  return NextResponse.json({ rules: state.rules });
}
