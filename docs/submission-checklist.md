# Submission Checklist — BUIDL CTC 2026 Fall

[Official BUIDL CTC page](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail) checked 2026-09-01: **deadline 2026-09-13 23:59 ET** · winners announced **2026-09-20**. Internal target: submit a complete draft by **2026-09-11 ET**, leaving two days for portal or video failures.

## Non-negotiable portal fields

- [ ] **Project name:** AttestFlow — Proof-Gated Cross-Chain Payments
- [x] **Local project logo:** `docs/attestflow-logo.png` · square PNG · checked at full size and 48 px
- [ ] **Project logo upload:** use `docs/attestflow-logo.png` in the DoraHacks project profile
- [ ] **Project sector:** AI
- [ ] **One-line description:** “A natural-language agent that proves Sepolia payments through Attestcoin, settles deterministic escrow on Creditcoin, and returns the exact settlement payload cross-chain.”
- [ ] **Long description:** adapt README sections “Why this needs Attestcoin,” “Integration depth,” and “Honest boundary.”
- [x] **Copy-ready portal text:** `docs/submission-copy.md` (replace only team and video placeholders)
- [ ] **Public GitHub URL:** `https://github.com/ximilu0114-droid/ximilu-hackson`
- [x] **Local judge deck:** `docs/attestflow-pitch-deck.pdf` plus editable `docs/attestflow-pitch-deck.pptx`; nine slides, final PDF render checked page by page
- [ ] **Deck/Whitepaper portal URL:** use the public pitch-deck PDF first; keep `docs/whitepaper.pdf` as the technical backup
- [ ] **Demo video URL:** approve or re-narrate the checked 2:29 review cut, upload Unlisted/Public, verify signed-out access
- [ ] **Attestcoin integration summary:** link `docs/integration.md`
- [ ] **Team identity:** real first/last name, email, country of residence, citizenship, role, short bio; Telegram/X/LinkedIn if requested
- [ ] **Originality declaration:** confirm the submission is original and disclose reused open-source dependencies
- [ ] **Eligibility:** personally confirm every legal/eligibility statement before checking it
- [ ] **Third-party services:** disclose hosted prover, public RPCs, explorers, and optional OpenAI-compatible endpoint

## Suggested integration summary

> AttestFlow uses the live ChainInfo registry, ProofBuilder, Merkle and continuity proofs, the native BlockProver `verify()` and `calculateTxIndex()`, and protocol encoding v1 inside a deployed CC3 ASC. The ASC independently enforces receipt success, proof-index binding, policy match, replay protection, escrow, and a destination-bound payload. Because official Writability Outbox/Inbox contracts are not deployed on the target testnet, the return leg is explicitly labeled as a four-stage adapter using one authorized relayer rather than an attestor quorum.

## Repository readiness

- [x] English README with verified commands and judge-first evidence
- [x] MIT license and security policy
- [x] `.env` ignored; no testnet private key or seed committed
- [x] Current ASC and Inbox ABI/deployment snapshots committed
- [x] ChainInfo, BlockProver, proof encoding, and Writability boundary documented
- [x] 28 tests: 15 contracts, 8 agent/protocol/policy, and 5 web policy-boundary tests
- [x] CI, CodeQL, Dependabot, production build, and dependency audit
- [x] `/judge` evidence page passes desktop and 390 px mobile QA
- [x] Machine-checkable live evidence manifest and 62-check verifier
- [x] 2:29 / 1080p local review cut, captions, poster, and reproducible renderer
- [x] Square project logo plus Next.js app icon
- [x] Push the final hardening commit and confirm GitHub Actions is green
- [ ] Replace any final video placeholder with the tested video URL
- [x] Confirm repository visibility is Public while signed out

## GitHub presentation settings

The public audit found that GitHub currently shows `No description, website, or topics provided` and the repository name is still `ximilu-hackson`. Before sharing the final portal URL:

- [ ] **Repository name:** rename to `attestflow` or `attestflow-buidl-ctc`, then update the canonical URLs in the submission copy
- [ ] **About description:** `Proof-gated cross-chain payments for autonomous agents, powered by Attestcoin on Creditcoin CC3.`
- [ ] **Topics:** `attestcoin`, `creditcoin`, `cross-chain`, `autonomous-agents`, `payments`, `solidity`, `typescript`, `sepolia`
- [ ] **Social preview:** upload `docs/attestflow-demo-poster.png`
- [ ] Confirm the renamed repository, badges, PDF, MP4 fallback, and all explorer links while signed out

## Evidence index

| Claim | Public artifact |
|---|---|
| Source payment · Sepolia | `0x6ac68ba923494389999206236504123521d8ecdb9463f60aa52da47d59d555e7` |
| Source block / index / status | `11608703 / 69 / 1` |
| ASC deployment · CC3 | `0x4E7410Ebf41C213378E1D8aA4423323303086bF6` |
| ASC deployment tx | `0x782d27be9fbb2ba515d77e0e6f4987f3810eb297cd4f189ec72b08cb7ffca6c6` |
| Proof-gated settlement · CC3 | `0xec29d5b4046d5557c014d6720e6d3799ba0f0b41e31a71147240a09b89c2e4c2` |
| Proof-derived sourceTxId | `0x780a2c1665d5c3b62f3326cf745659376f3f566dd0b3ad645e16c44f2f28fd1a` |
| Published/executed payload hash | `0x4845f5ca486987ddb30d486e58f36ed0cebbf5e514d20783d220b06f0d523faa` |
| InboxDemo · Sepolia | `0x83A0b8D26Dd28094eE0CA74E57e79028194f868E` |
| Destination execution · Sepolia | `0xc692a176f78b1541104e9e0a18f9a8404c585b15e9be2c695df3d118796947fb` |
| Canonical manifest | `evidence/live-e2e-v2.json` |

## Judge-path rehearsal

Run from a clean clone or a temporary checkout:

```bash
npm ci
npm run judge:verify
```

Expected:

- [x] TypeScript exits 0.
- [x] Agent tests: 8 passing.
- [x] Web policy tests: 5 passing.
- [x] Contract tests: 15 passing.
- [x] Next.js production build exits 0 and includes `/judge`.
- [x] Production audit reports 0 vulnerabilities at the configured threshold.
- [x] Evidence verifier prints `"status": "SUCCESS"` and `"checks": 62`.
- [x] Fresh proof smoke test prints `"verification": "SUCCESS"`.
- [x] Unified verifier finishes with `"step": "judge-verify"` and `"status": "SUCCESS"`.

Last rehearsed from a fresh public clone at commit `3d8d0e2` on 2026-09-01: clone 5.1 s, `npm ci` 10.8 s, and the unified `judge:verify` 29.7 s. Its three gates all returned `SUCCESS`, including a fresh proof for Sepolia block `11609889`; timings are environment-dependent.

## Video acceptance

- [x] Outcome and three public transaction links appear in the first 15 seconds.
- [x] Product dashboard appears before 0:40.
- [x] Narration distinguishes inclusion/continuity from receipt success.
- [x] Proof-derived transaction index and replay defense are named.
- [x] Honest Writability boundary is stated.
- [x] Actual `npm run verify:evidence` output finishes on camera with `SUCCESS` / 62 checks.
- [x] No secrets, personal notifications, or private-wallet information appear.
- [x] Captions checked; transaction hashes remain readable at 1080p.
- [ ] Video opens in a private browser window without authentication.

## Final portal dry run

- [ ] Open every README, PDF, video, source, CC3 explorer, and Etherscan link while signed out.
- [ ] Download the uploaded PDF once and compare its page count and first/last pages with the repository copy.
- [ ] Paste the final portal text into a local backup before submission.
- [ ] Screenshot the completed portal fields before clicking Submit.
- [ ] Submit by 2026-09-11 ET; confirm the submission appears in the project dashboard.
- [ ] Re-open the submission after confirmation and ensure links were not truncated.

## Human-only blockers

The repository cannot safely infer or submit these:

1. real member identity, nationality/citizenship, and eligibility attestations;
2. approval of the checked narration (or a human re-record), public video upload, and signed-out URL test;
3. GitHub repository rename/About/topics/social-preview settings;
4. the final DoraHacks submission click.

Do not mark the project complete until all four are confirmed.
