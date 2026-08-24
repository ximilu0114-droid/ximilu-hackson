# Demo Video Script (2:30)

> Recording setup: 1440×900 or 1920×1080, terminal font ~16pt, dashboard at localhost:3100,
> pre-open tabs: Creditcoin explorer + Sepolia Etherscan. Record with QuickTime (⌘⌥N → select area).
> Do a dry rehearsal first — every command below is verified and fast.

## 0. Cold open (0:00–0:15) — dashboard

**Say:** "Freelancers wait days for cross-border payments to clear. AttestFlow settles them in one transaction — with cryptographic proof, on Creditcoin."

**Show:** dashboard `localhost:3100`. Point at the LIVE badge and the pipeline feed (settled rows from earlier runs).

## 1. The rule (0:15–0:40) — natural language

**Say:** "The user's intent is one sentence."

```bash
npm run start --prefix agent -- --rule "当我在 Sepolia 收到 ≥100 USDC 时，按 10% 释放" --once
```

**Show:** the agent logs: rule parsed (min=100 USDC, ratio 10%) → matches → proof → settle → delivered.
**Say:** "No API keys, no human. The agent found a real USDC payment in the attested window, generated an inclusion proof, and settled it on Creditcoin."

## 2. The proof is real (0:40–1:10) — explorer

**Show:** open the CC3 explorer settlement tx from the log (e.g. `0x9c8caf6b…`).
Point at: `PaymentSettled` event, gas ~190k, block on CC3 testnet.

**Say:** "This settlement could not happen without a valid Merkle and continuity proof — the Attestcoin precompile at 0x0FD2 verifies them inside the transaction. And because the precompile proves inclusion but not success, the contract decodes the attested receipt and rejects failed transactions — there's a test for exactly that attack."

## 3. The loop closes (1:10–1:35) — writability

**Show:** Sepolia Etherscan tx `0xd6abf721…` — InboxDemo `MessageExecuted`.

**Say:** "The settlement result travels back as a signed message and executes on Sepolia — the same publish, sign, deliver, validate semantics as Attestcoin writability. Official Outbox/Inbox aren't on testnet yet, so we run the identical four steps with a validating inbox — and the swap is a drop-in when they ship."

## 4. It watches live (1:35–2:05) — the money moment

**Say:** "Now watch it react to a brand-new payment in real time."

Terminal 1:
```bash
LIVE=1 ASC_ADDRESS=0x0cFd2f6eBA1B2B8Af9C5a49c886b8F950594374F \
INBOX_ADDRESS=0x83A0b8D26Dd28094eE0CA74E57e79028194f868E \
npm run start --prefix agent
```

Terminal 2 (send ≥100 USDC to any fresh address — e.g. from another funded testnet wallet):
```bash
# any real USDC transfer works; the agent picks it up within ~30s
```

**Show:** agent log: `match → LIVE settle mined → settled+delivered`, then dashboard auto-refreshing with the new pipeline row (match→proved→settled→delivered stepper turning green).

**Say:** "Payment in, settlement out, message delivered — nobody touched a keyboard."

## 5. Why it matters (2:05–2:30)

**Show:** README quickstart section scrolling.

**Say:** "AttestFlow = Attestcoin proofs for truth, a smart-contract spine for trust, and an AI agent for autonomy. Everything is open source, reproducible from the README in under 30 minutes, and every claim is a transaction hash you can click."

---

### Pre-flight checklist for recording day
- [ ] `npm run e2e:proof` passes (prover service healthy)
- [ ] Dashboard `npm run dev --prefix web` shows LIVE badge + history
- [ ] Agent wallet has ≥400 CTC (escrow auto-top-up to 500) and ≥0.02 Sepolia ETH
- [ ] A USDC transfer ≥100 USDC happened recently (agent scans last 400 attested blocks)
- [ ] Explorer tabs pre-loaded with the evidence txs
