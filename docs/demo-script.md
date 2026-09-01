# Demo Video Runbook — 2:30

Goal: make a judge understand the user value in 15 seconds, see a real product by 35 seconds, and independently trust the cross-chain claim by 1:50.

Record at 1920×1080 or 1440×900. Use a 16–18 pt terminal font and hide bookmarks, notifications, wallet balances, `.env`, and all secrets. Pre-open:

1. `http://localhost:3100`
2. `http://localhost:3100/judge`
3. the three transaction links from the judge page
4. a terminal at the repository root

## 0:00–0:15 — outcome first

**Show:** `/judge`, top section and three-chain cards.

**Say:**

> “AttestFlow gives a cross-border freelancer automatic escrow without trusting a payment oracle. This is one real 0.01 ETH payment on Sepolia, one Attestcoin-verified release on Creditcoin, and the exact settlement payload executed back on Sepolia.”

Pause briefly over each linked transaction card.

## 0:15–0:38 — the product

**Show:** main dashboard. Create or point to:

> “When I receive at least 0.01 ETH on Sepolia, release 10%.”

Point to the active rule, then the `match → proved → settled → delivered` stepper.

**Say:**

> “The agent translates intent into an inspectable policy, watches only blocks already attested by Creditcoin, builds the proof, settles escrow, and delivers the result. The model is never trusted to say a payment happened.”

## 0:38–1:10 — why the proof is real

**Show:** CC3 settlement transaction `0xec29d5b4046d5557c014d6720e6d3799ba0f0b41e31a71147240a09b89c2e4c2`, then the security-invariants list on `/judge`.

**Say:**

> “Inside this CC3 transaction, the native BlockProver verifies the Merkle and continuity proofs. The contract derives the transaction index from the proof itself, checks the attested receipt status, recipient, amount, policy, replay state, and escrow before releasing 0.001 CTC.”

Point specifically to **Index binding** and **Source success**. These are differentiators, not generic smart-contract checks.

## 1:10–1:32 — the loop closes

**Show:** Sepolia `MessageExecuted` transaction `0xc692a176f78b1541104e9e0a18f9a8404c585b15e9be2c695df3d118796947fb`, then the payload hash card.

**Say:**

> “The exact bytes published by the CC3 settlement are signed, delivered, and replay-checked on Sepolia. The payload hash is identical on both chains.”

Then point to **Honest boundary**.

> “Official Writability contracts are not on this testnet, so this leg uses one authorized relayer and does not pretend to have attestor-quorum security.”

## 1:32–1:58 — let the repository prove it

**Show:** terminal; run this before recording once to warm RPC connections, then run it again on camera:

```bash
npm run verify:evidence
```

Let the final JSON remain on screen.

**Say:**

> “This verifier re-reads both public chains, performs 62 assertions, checks both replay guards, compares the cross-chain payload, and confirms that deployed bytecode matches this source build.”

## 1:58–2:18 — resilience, not a happy-path toy

**Show:** `/judge` crash-recovery invariant, or briefly open `docs/integration.md` section 5.

**Say:**

> “During this live run, CC3 finalized and the Sepolia RPC timed out. On restart, the agent recovered the original published payload from chain logs and completed only the missing destination leg—without a second settlement.”

## 2:18–2:30 — close

**Show:** repository README quickstart and CI badge.

**Say:**

> “Natural language for intent, Attestcoin for truth, and deterministic contracts for money. AttestFlow is open source, testnet-deployed, and independently reproducible.”

End on the three linked transactions, not on a terminal.

---

## Optional live-agent insert

If the video may be 3 minutes, add a 20-second terminal clip. Use the current deployment and a fresh temporary state file so the repository's real dashboard state is untouched:

```bash
STATE_FILE=/tmp/attestflow-video-state.json \
LOG_FILE=/tmp/attestflow-video.log \
LIVE=1 \
ASC_ADDRESS=0x4E7410Ebf41C213378E1D8aA4423323303086bF6 \
INBOX_ADDRESS=0x83A0b8D26Dd28094eE0CA74E57e79028194f868E \
npm run start --prefix agent -- \
  --rule "当我在 Sepolia 收到 ≥0.01 ETH 时，按 10% 释放" \
  --tx 0x6ac68ba923494389999206236504123521d8ecdb9463f60aa52da47d59d555e7 \
  --once
```

This requires the same testnet-only agent wallet used as the recorded payee. It rebuilds the real proof, observes the on-chain replay guard, recovers the CC3 receipt payload, and confirms the already-executed destination leg. It does not spend gas or create a duplicate settlement.

For a brand-new settlement, send a qualifying payment to the demo wallet at least one attestation cycle before recording, then pass its hash through `--tx`. Do not wait for a just-mined transaction during the recording.

## Recording-day acceptance

- [ ] `npm ci`, `npm run ci`, and `npm run verify:evidence` pass.
- [ ] Dashboard renders at desktop width; `/judge` shows 62 live checks.
- [ ] All three explorer pages load and show successful transactions.
- [ ] Demo video contains no private key, seed, `.env`, personal wallet, or notification.
- [ ] Writability limitation is spoken once, clearly and without euphemism.
- [ ] Narration says “proof of inclusion and continuity,” then separately says the ASC checks receipt success.
- [ ] Final export is 1080p, readable at 1× speed, and under the portal limit.
- [ ] Upload is Unlisted or Public, opens while signed out, and has captions.
- [ ] Replace the README video placeholder/link only after the final URL works.
