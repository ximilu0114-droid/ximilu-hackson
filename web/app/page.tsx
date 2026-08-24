'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Stage = 'match' | 'proved' | 'settled' | 'rejected' | 'delivered';

interface Pipeline {
  tx: string;
  stages: Record<string, { ts: string; detail?: string }>;
  current: Stage;
}

interface EventsResp {
  lastHeight: number;
  live: boolean;
  stats: { rules: number; settled: number; rejected: number; deliveries: number };
  pipelines: Pipeline[];
}

interface Rule {
  id: string;
  text: string;
  engine: string;
  active: boolean;
}

const STAGES: Stage[] = ['match', 'proved', 'settled', 'delivered'];
const STAGE_LABEL: Record<string, string> = {
  match: 'Matched',
  proved: 'Proved',
  settled: 'Settled',
  rejected: 'Rejected',
  delivered: 'Delivered',
};

export default function Dashboard() {
  const [ev, setEv] = useState<EventsResp | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleText, setRuleText] = useState('');
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [e, r] = await Promise.all([
        fetch('/api/events').then((x) => x.json()),
        fetch('/api/rules').then((x) => x.json()),
      ]);
      setEv(e);
      setRules(r.rules ?? []);
    } catch {
      /* keep last good data */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function createRule() {
    if (!ruleText.trim()) return;
    setBusy(true);
    await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ruleText }),
    });
    setRuleText('');
    await refresh();
    setBusy(false);
  }

  async function toggleRule(id: string) {
    await fetch('/api/rules/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await refresh();
  }

  async function ask() {
    if (!question.trim()) return;
    setAnswer('thinking…');
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }).then((x) => x.json());
    setAnswer(res.answer);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AttestFlow</h1>
          <p className="text-sm text-zinc-400">
            Cross-chain verified payment engine · Attestcoin Protocol · Sepolia → CC3 Testnet
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded-full bg-zinc-800 px-3 py-1">height #{ev?.lastHeight ?? '—'}</span>
          <span
            className={`rounded-full px-3 py-1 ${
              ev?.live ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'
            }`}
          >
            {ev?.live ? 'LIVE' : 'DRY'} mode
          </span>
        </div>
      </header>

      {/* Stats */}
      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Rules" value={ev?.stats.rules ?? 0} />
        <Stat label="Settled" value={ev?.stats.settled ?? 0} accent="emerald" />
        <Stat label="Rejected (safety)" value={ev?.stats.rejected ?? 0} accent="amber" />
        <Stat label="Deliveries out" value={ev?.stats.deliveries ?? 0} accent="sky" />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: rules */}
        <section className="lg:col-span-2 space-y-6">
          <Card title="New rule (natural language)">
            <textarea
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
              rows={3}
              placeholder='e.g. 当我在 Sepolia 收到 ≥100 USDC 时，按 10% 释放给受益人'
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm outline-none focus:border-emerald-600"
            />
            <button
              onClick={createRule}
              disabled={busy || !ruleText.trim()}
              className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-40 hover:bg-emerald-500"
            >
              Register rule
            </button>
            <p className="mt-2 text-xs text-zinc-500">
              Parsed deterministically on-device; optional LLM engine disclosed in submission.
            </p>
          </Card>

          <Card title={`Active rules (${rules.length})`}>
            <ul className="space-y-3">
              {rules.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 rounded-lg bg-zinc-900 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{r.text}</p>
                    <p className="text-xs text-zinc-500">
                      {r.id} · {r.engine}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleRule(r.id)}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                      r.active ? 'bg-emerald-900/70 text-emerald-300' : 'bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    {r.active ? 'ON' : 'OFF'}
                  </button>
                </li>
              ))}
              {rules.length === 0 && <li className="text-sm text-zinc-500">No rules yet.</li>}
            </ul>
          </Card>

          <Card title="Ask history (NL query)">
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder="释放了多少？最近事件？"
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-sm outline-none focus:border-sky-600"
              />
              <button onClick={ask} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold hover:bg-sky-600">
                Ask
              </button>
            </div>
            {answer && (
              <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-900 p-3 text-xs text-zinc-300">{answer}</pre>
            )}
          </Card>
        </section>

        {/* Right: pipeline feed */}
        <section className="lg:col-span-3">
          <Card title="Verification pipeline (live)">
            <div ref={feedRef} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
              {ev?.pipelines.map((p) => (
                <div key={p.tx} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <a
                      href={`https://sepolia.etherscan.io/tx/${p.tx}`}
                      target="_blank"
                      className="font-mono text-xs text-sky-400 hover:underline"
                    >
                      {p.tx.slice(0, 22)}…
                    </a>
                    <span
                      className={`text-xs ${
                        p.current === 'rejected'
                          ? 'text-amber-400'
                          : p.current === 'delivered'
                            ? 'text-emerald-400'
                            : 'text-zinc-400'
                      }`}
                    >
                      {STAGE_LABEL[p.current]}
                    </span>
                  </div>
                  <ol className="grid grid-cols-4 gap-1 sm:gap-2">
                    {STAGES.map((s, i) => {
                      const done = !!p.stages[s];
                      const rejected = s === 'settled' && p.current === 'rejected';
                      return (
                        <li key={s}>
                          <div
                            className={`h-1.5 rounded-full ${
                              done ? (rejected ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-zinc-800'
                            } ${i === STAGES.length - 1 && done && !rejected ? 'bg-sky-500' : ''}`}
                          />
                          <p className="mt-1 truncate text-[10px] uppercase tracking-wide text-zinc-500 sm:text-xs">
                            {STAGE_LABEL[s]}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
              {(ev?.pipelines.length ?? 0) === 0 && (
                <p className="py-16 text-center text-sm text-zinc-500">
                  No settlements yet. The agent fills this feed as it matches payments.
                </p>
              )}
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, accent = 'zinc' }: { label: string; value: number; accent?: string }) {
  const color =
    accent === 'emerald' ? 'text-emerald-400' : accent === 'amber' ? 'text-amber-400' : accent === 'sky' ? 'text-sky-400' : '';
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </div>
  );
}
