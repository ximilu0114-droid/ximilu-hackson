# AI Trust Boundary — Proposal Is Not Authorization

AttestFlow uses AI for language understanding and history questions, but never as a source of payment truth or as an unreviewed authority over funds. The product separates four decisions that are often collapsed inside an "AI agent":

| Decision | Authority | Fail-closed control |
|---|---|---|
| What the user intends | User | Review exact asset, threshold, and payout percentage before activation |
| How language maps to fields | Optional LLM or deterministic compiler | Strict JSON schema, supported-asset allowlist, exact integer conversion, no defaults, exact agreement with locally extracted fields |
| Whether the source payment happened | Attestcoin | Merkle + continuity proof accepted by the native CC3 BlockProver |
| Whether money may move | AttestFlowASC | Receipt success, proof-derived identity, policy match, replay, and escrow checks |

## The authorization sequence

```text
natural-language request
        |
        v
compile explicit policy fields
        |
        +-- missing / unsupported / out of range --> reject
        |
        v
inactive draft shown to user
        |
        +-- explicit Activate --> active policy
        |
        v
autonomous watch -> Attestcoin proof -> deterministic ASC settlement
```

The dashboard always creates an inactive draft. It exposes the compiled asset, base-unit threshold, and payout percentage before the Activate action is available. Activation revalidates the persisted fields, so modifying state cannot turn an invalid draft into an active policy.

The CLI preserves a reproducible no-API-key path: a fully explicit rule compiled by the deterministic parser is authorized by that exact CLI invocation. If `OPENAI_API_KEY` is enabled and a model compiles the rule, the agent stores it as `REVIEW_REQUIRED`, exits when no active policy exists, and requires a later `--activate <rule-id>` invocation after inspection.

## Inputs that never become active policy

- a rule with no explicit asset and positive amount;
- a rule with no explicit payout percentage;
- a rule that does not bind the agent wallet, amount, and Sepolia to the same self-receipt clause;
- a rule containing multiple candidate payment amounts/assets or payout percentages;
- unsupported assets or source chains;
- ambiguous thousands separators or asset-prefix tricks such as `USDT` matching `U`;
- more decimal places than the selected asset supports;
- zero, negative, malformed, or greater-than-100% payout values;
- incomplete, non-JSON, fenced, extra-key, numeric-instead-of-string, or adversarial model output;
- model output whose asset, amount, or payout percentage differs from the deterministic extraction of the user's explicit text;
- a persisted draft whose fields no longer pass the local activation validator.

The deterministic compiler validates the source text before it is sent to an optional model. Invalid or disagreeing model output falls back only to that already-validated local result. It does not fall back to invented values.

## What AI still cannot do after activation

Activation authorizes a bounded policy, not a payment. The source event must still pass all contract gates in one CC3 transaction. No prompt, model response, API compromise, agent log, or database value can substitute for an Attestcoin proof, a successful attested receipt, the proof-derived transaction index, the stored payee/asset/threshold, unused replay state, and sufficient escrow.

History Q&A has an even narrower capability: the model receives a bounded JSON snapshot, is instructed to treat snapshot strings as data, and cannot call settlement code.

## Reproduce the boundary

```bash
npm run test:agent  # model JSON, missing fields, unsafe values, persisted drafts
npm run test:web    # exact parsing, fail-closed input, activation validation
npm run ci          # all 32 tests + production build + production audit
```

The relevant implementation is in:

- `agent/src/llm.ts` — fail-closed compilation and model-output validation;
- `agent/src/index.ts` — `REVIEW_REQUIRED` drafts and explicit CLI activation;
- `web/lib/parse.ts` — exact unit conversion and activation-time validation;
- `web/app/api/rules/route.ts` — inactive draft creation;
- `web/app/api/rules/toggle/route.ts` — revalidation before activation;
- `contracts/contracts/AttestFlowASC.sol` — the final proof-gated authority.

This boundary is the reason AttestFlow can be autonomous after setup without making an LLM a payment oracle or an unreviewed policy administrator.
