# Submission Checklist — BUIDL CTC 2026 Fall

Deadline: **2026-09-06 23:59 ET** · Winners: 2026-09-18 · Submit early (target 9/4).

## DoraHacks form fields

- [ ] **Project name**: AttestFlow — Cross-Chain Verified Payment Engine
- [ ] **Project sector (track)**: AI
- [ ] **Description**: see README intro (copy 2–3 paragraphs)
- [ ] **Attestcoin Protocol Integration Summary**: point to `docs/integration.md`; one-line: "Readability (ProofBuilder + 0x0FD2 precompile verified in-ASC, receipt-status enforced) + Writability four-step adapter (MessagePublished → signed delivery → validating InboxDemo), ChainInfo discovery, prover REST."
- [ ] **GitHub repo URL**: `<public repo>` (must be public; README is the entry point)
- [ ] **Deck/Whitepaper PDF**: `docs/whitepaper.pdf`
- [ ] **Demo video URL** (YouTube unlisted): `<record from docs/demo-script.md>`
- [ ] **Team info** (per member): first/last name, email, Telegram (opt), X (opt), LinkedIn (opt), bio, role, country of residence + citizenship
- [ ] Eligibility confirmed (no criminal record etc.)

## Repo readiness

- [x] README with repro steps (validated: fresh clone → tests + live proof in <2 min)
- [x] Open-source license (MIT)
- [x] No secrets in git (`.env` gitignored; wallet is testnet-only)
- [x] Third-party disclosure section in README (LLM optional, prover service, public RPCs)
- [x] Deployed addresses + ABI snapshots in `deployments/`
- [ ] **Push to GitHub** (needs remote):
  ```bash
  git remote add origin git@github.com:<user>/attestflow.git
  git push -u origin main --tags
  ```

## Demo video (2:30)

- [ ] Record per `docs/demo-script.md` (all commands verified; checklist inside)
- [ ] Upload YouTube (unlisted) → paste URL into README `DEMO_VIDEO_URL` badge → commit + push

## Evidence index (clickable hashes for judges)

| What | Hash |
|---|---|
| Settlement (CC3) | `0x9c8caf6ba81abd605c485d1e0ab732cb307dfb7b15794c719606abba710d25b6` |
| Writability delivery (Sepolia) | `0xd6abf72128f57c52cbd95ec3a9a197fdabedd3747b43729628795d03035e9389` |
| Clean-round settlement (CC3) | `0xb6867873835193e253963709696405c0ef43d13f94950ecbea5f81dacb76549e` |
| Clean-round delivery (Sepolia) | `0xe01193bb449f7e9bb774727d929795b9037a4ed91959026887fe3754f9ad49cc` |
| ASC contract | `0x0cFd2f6eBA1B2B8Af9C5a49c886b8F950594374F` |
| InboxDemo contract | `0x83A0b8D26Dd28094eE0CA74E57e79028194f868E` |

## Final sanity before submit

- [ ] `npm install && npm run typecheck && npm run test:contracts` green on fresh clone
- [ ] `npm run e2e:proof` → SUCCESS
- [ ] README badge URLs work (video + explorer links)
- [ ] All third-party services disclosed
