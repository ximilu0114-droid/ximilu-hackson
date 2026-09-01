import Link from 'next/link';
import evidence from '../../../evidence/live-e2e-v2.json';

const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-8)}`;

const steps = [
  {
    number: '01',
    eyebrow: 'Ethereum Sepolia',
    title: 'A real client payment succeeds',
    detail: '0.01 native ETH · status 1 · payer and payee independently verified',
    hash: evidence.source.txHash,
    href: `https://sepolia.etherscan.io/tx/${evidence.source.txHash}`,
    tone: 'border-sky-500/40 bg-sky-500/5',
  },
  {
    number: '02',
    eyebrow: 'Creditcoin CC3',
    title: 'The ASC proves, checks and settles',
    detail: 'Attestcoin verify + proof-derived index + receipt status + replay guard',
    hash: evidence.settlement.txHash,
    href: `https://creditcoin-testnet.blockscout.com/tx/${evidence.settlement.txHash}`,
    tone: 'border-emerald-500/40 bg-emerald-500/5',
  },
  {
    number: '03',
    eyebrow: 'Ethereum Sepolia',
    title: 'The exact published payload executes',
    detail: 'Same payload hash · authorized signature · destination replay guard',
    hash: evidence.delivery.txHash,
    href: `https://sepolia.etherscan.io/tx/${evidence.delivery.txHash}`,
    tone: 'border-violet-500/40 bg-violet-500/5',
  },
];

const invariants = [
  ['Proof inclusion', 'BlockProver verify() accepted on CC3'],
  ['Index binding', 'calculateTxIndex() = Sepolia receipt index 69'],
  ['Source success', 'Attested receipt status = 1'],
  ['Policy match', 'Payee and 0.01 ETH value match the rule'],
  ['Replay safety', 'ASC and Inbox replay guards are both set'],
  ['Payload integrity', 'CC3 publish hash = Sepolia execute hash'],
  ['Code identity', 'Deployed runtime bytecode = local Solidity build'],
  ['Crash recovery', 'Destination leg resumed without a second settlement'],
];

export default function JudgeEvidence() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-12 flex items-center justify-between text-sm">
        <Link href="/" className="font-semibold tracking-tight text-zinc-100">
          AttestFlow
        </Link>
        <a
          href="https://github.com/ximilu0114-droid/ximilu-hackson"
          target="_blank"
          rel="noreferrer"
          className="text-zinc-400 transition hover:text-white"
        >
          Source ↗
        </a>
      </nav>

      <section className="mb-14 max-w-4xl">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          62 live checks · 2 exact source matches
        </div>
        <h1 className="text-balance text-4xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-6xl">
          One payment. Two chains. No trusted payment oracle.
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-400">
          AttestFlow turns a natural-language settlement rule into a proof-bound
          CC3 action, then carries the exact on-chain result back to the source
          chain. Every hash below is public, final on testnet and re-verifiable.
        </p>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-500">
          The first use case is cross-border freelance escrow: the client pays
          where liquidity already exists, while Creditcoin releases only after
          the exact external payment is cryptographically proven.
        </p>
      </section>

      <section id="evidence" className="grid scroll-mt-6 gap-4 lg:grid-cols-3">
        {steps.map((step) => (
          <article key={step.number} className={`rounded-2xl border p-5 ${step.tone}`}>
            <div className="mb-8 flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {step.eyebrow}
              </p>
              <span className="font-mono text-xs text-zinc-600">{step.number}</span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-100">{step.title}</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-zinc-400">{step.detail}</p>
            <a
              href={step.href}
              target="_blank"
              rel="noreferrer"
              className="mt-6 block font-mono text-xs text-zinc-300 transition hover:text-white"
            >
              {short(step.hash)} ↗
            </a>
          </article>
        ))}
      </section>

      <section id="security" className="mt-14 grid scroll-mt-6 gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Security invariants
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">What the verifier proves</h2>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              8 / 8
            </span>
          </div>
          <div className="divide-y divide-zinc-800">
            {invariants.map(([name, detail]) => (
              <div key={name} className="grid gap-1 py-3 sm:grid-cols-[150px_1fr] sm:gap-4">
                <p className="text-sm font-medium text-zinc-200">{name}</p>
                <p className="text-sm text-zinc-500">{detail}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Integrity anchor
            </p>
            <p className="mt-3 text-sm text-zinc-400">Published payload hash</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-emerald-300">
              {evidence.message.payloadHash}
            </p>
            <dl className="mt-6 space-y-3 border-t border-zinc-800 pt-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">SourceTxId</dt>
                <dd className="font-mono text-zinc-300">{short(evidence.settlement.sourceTxId)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Released</dt>
                <dd className="text-zinc-300">0.001 CTC</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Destination</dt>
                <dd className="font-mono text-zinc-300">{short(evidence.message.destContract)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
              Honest boundary
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Official Writability contracts are not live on this testnet. The
              return leg mirrors publish → sign → deliver → validate with one
              authorized relayer; it does not claim attestor-quorum security.
            </p>
          </div>
        </aside>
      </section>

      <section
        id="protocol-depth"
        className="mt-14 scroll-mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
          Attestcoin depth
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">
          Single settlement, shared batch admission, exact compiler identity.
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            {
              name: 'Live single-proof authority',
              detail: 'The deployed ASC calls native verify() and calculateTxIndex() before receipt, policy, replay and escrow checks.',
              href: `https://creditcoin-testnet.blockscout.com/tx/${evidence.settlement.txHash}`,
              label: 'Open settlement',
            },
            {
              name: 'Fail-closed batch backlog gate',
              detail: 'Two to ten matches share one continuity proof and must pass exact membership, Merkle-index and native verifyBatch() checks before settlement.',
              href: 'https://github.com/ximilu0114-droid/ximilu-hackson/blob/main/docs/attestcoin-depth.md',
              label: 'Inspect depth ledger',
            },
            {
              name: 'AttestFlowASC exact match',
              detail: 'Sourcify independently matches both creation and runtime bytecode to the published Hardhat compiler input.',
              href: 'https://repo.sourcify.dev/102031/0x4E7410Ebf41C213378E1D8aA4423323303086bF6',
              label: 'Open source record',
            },
            {
              name: 'InboxDemo exact match',
              detail: 'The disclosed single-relayer testnet adapter is equally inspectable, including its signature and destination replay checks.',
              href: 'https://repo.sourcify.dev/11155111/0x83A0b8D26Dd28094eE0CA74E57e79028194f868E',
              label: 'Open source record',
            },
          ].map((item) => (
            <article key={item.name} className="rounded-xl border border-emerald-500/15 bg-black/20 p-4">
              <h3 className="text-sm font-semibold text-zinc-200">{item.name}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{item.detail}</p>
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-sm font-medium text-emerald-300 transition hover:text-emerald-200"
              >
                {item.label} ↗
              </a>
            </article>
          ))}
        </div>
        <pre className="mt-5 overflow-x-auto rounded-xl border border-emerald-500/15 bg-black/30 p-4 text-xs leading-6 text-zinc-300">
          <code>{`npm run e2e:batch-proof\n# 3 distinct blocks · shared continuity proof · verifyBatch() SUCCESS`}</code>
        </pre>
      </section>

      <section
        id="ai-boundary"
        className="mt-14 scroll-mt-6 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">
          AI authorization boundary
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">
          The model can propose fields. It cannot authorize money.
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ['01 · Compile', 'The local gate requires explicit Sepolia, self-payee and one money tuple; model fields must agree.'],
            ['02 · Review', 'The dashboard saves an inactive draft and exposes exact money fields before activation.'],
            ['03 · Execute', 'Even an active policy still needs Attestcoin truth and every deterministic ASC gate.'],
          ].map(([name, detail]) => (
            <div key={name} className="rounded-xl border border-sky-500/15 bg-black/20 p-4">
              <p className="text-sm font-semibold text-zinc-200">{name}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{detail}</p>
            </div>
          ))}
        </div>
        <a
          href="https://github.com/ximilu0114-droid/ximilu-hackson/blob/main/docs/ai-trust-boundary.md"
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-block text-sm font-medium text-sky-300 transition hover:text-sky-200"
        >
          Read the threat matrix and adversarial tests ↗
        </a>
      </section>

      <section id="reproduce" className="mt-14 scroll-mt-6 rounded-2xl border border-zinc-800 bg-black p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Reproduce the verdict
        </p>
        <pre className="mt-4 overflow-x-auto text-sm leading-7 text-zinc-300">
          <code>{`npm ci\nnpm run judge:verify\n# → { "step": "judge-verify", "status": "SUCCESS" }`}</code>
        </pre>
      </section>
    </main>
  );
}
