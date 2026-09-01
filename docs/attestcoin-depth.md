# Attestcoin Depth Ledger

The published judging focus is depth of Attestcoin Protocol utilization. This ledger maps each exercised capability to the product decision it controls, the shipped implementation, and evidence a judge can reproduce. It deliberately separates protocol use from application checks and from the not-yet-live official Writability quorum.

## Load-bearing protocol capabilities

| Capability | Product decision it controls | Shipped path | Failure behavior / evidence |
|---|---|---|---|
| Chain registry discovery | Whether Sepolia is an authorized source at all | `PrecompileChainInfoProvider.getSupportedChains()` in `agent/src/prover.ts` | Agent startup fails unless `chainId 11155111` maps to `chainKey 1`; the proof probes resolve it again independently. |
| Latest attested height | Which source blocks discovery may scan | ChainInfo `getLatestAttestedHeightAndHash()` in proof probes; prover `/attested-height/1` in watcher | Unattested blocks never become payment candidates. |
| Attestation wait | Whether a caller-supplied transaction is ready for proof generation | `waitUntilHeightAttested()` in `scripts/e2e-proof.ts` and batch probe | Times out without fabricating evidence. |
| Single proof generation | Merkle inclusion plus source-chain continuity for one payment | `ProofBuilder.getProof()` in the autonomous settlement loop | No proof means no call to the ASC. |
| Native single verification | Whether an individual proof is accepted by CC3 | `verifySingle()` in the gas-free judge probe; `verify()` inside `AttestFlowASC.settle()` | The public live settlement is impossible without precompile acceptance. |
| Shared batch proof generation | Whether a 2–10 payment backlog shares one valid continuity proof | `ProofBuilder.getBatchProof()` in `preflightBatchProof()` | A batch-service error leaves the scan cursor uncommitted and moves no member into settlement. |
| Native batch verification | Whether every backlog member is proven as one atomic preflight | `PrecompileBlockProver.verifyBatch()` in the agent and `scripts/e2e-batch-proof.ts` | Any rejected member stops the entire backlog chunk; there is no partial or assertion-only fallback. |
| Merkle-derived transaction index | The canonical source identity used for replay protection | `calculateTxIndex()` in the ASC; independent sibling-direction derivation in the agent | Caller/service disagreement reverts before the replay key is reserved. |
| Encoding-v1 transaction bytes | Payer, target, native value and ERC-20 calldata | Pure Solidity decoder plus an independent TypeScript decoder | Malformed or unsupported encoding reverts/fails closed. |
| Encoding-v1 receipt | Whether source execution actually succeeded | Last-chunk receipt decoder requires `status == 1` | This closes the inclusion-versus-success gap that the precompile intentionally does not decide. |

## Application enforcement after proof acceptance

Attestcoin answers whether the exact source transaction belongs to an attested chain. AttestFlow still requires all of the following before money moves:

1. the proof-derived index equals the supplied index;
2. receipt status is successful;
3. native target/value or ERC-20 contract/selector/recipient/amount matches the stored policy;
4. the proof-derived `keccak(chainKey,height,txIndex)` has never settled;
5. beneficiary, destination, payout ratio and active state equal the on-chain policy;
6. escrow covers the deterministic release.

The CC3 leg is checkpointed before destination I/O. If the destination RPC fails after settlement, restart recovery reads the original `MessagePublished` payload from the finalized receipt and executes only the missing destination leg.

## Batch path: product use, not a surface-count demo

When one attested scan returns multiple unprocessed matches, the agent divides them into chunks of at most ten. Every chunk of two or more transactions must first pass a shared `getBatchProof()` → exact membership/index checks → native `verifyBatch()` sequence. Only then does each payment enter the existing proof-gated ASC settlement path. A preflight exception occurs before the cursor checkpoint, so the whole source window is retried.

The standalone acceptance probe intentionally chooses one transaction from each of three distinct attested blocks. The 2026-09-02 run verified one shared proof across Sepolia blocks `11614867..11614869` and independently matched all three Merkle indices before CC3 returned `SUCCESS`.

```bash
npm run e2e:batch-proof
# → transactionCount: 3
# → sharedContinuityProof: true
# → verification: SUCCESS
```

Protocol limits are enforced before submission: 2–10 unique transactions and a maximum span of 1000 blocks.

## Public compiler identity

Both deployed application contracts have Sourcify `exact_match` results for creation and runtime bytecode:

| Contract | Network | Exact-match record |
|---|---|---|
| `AttestFlowASC` | Creditcoin CC3 · `102031` | [Sourcify record](https://repo.sourcify.dev/102031/0x4E7410Ebf41C213378E1D8aA4423323303086bF6) · match `47006308` |
| `InboxDemo` | Ethereum Sepolia · `11155111` | [Sourcify record](https://repo.sourcify.dev/11155111/0x83A0b8D26Dd28094eE0CA74E57e79028194f868E) · match `47006310` |

`npm run verify:sources` queries the public v2 records. If a record is missing, it submits the exact Hardhat standard JSON compiler input and gates success on the subsequent public contract lookup. Hardhat 2.26's bundled Sourcify integration still targets retired API v1, so the repository uses the current asynchronous v2 endpoint explicitly.

## Writability: exact boundary, no inflated claim

The official Outbox/Inbox contracts are not deployed on the target testnet. AttestFlow therefore does **not** claim attestor-quorum Writability. It implements and live-tests the documented application interface:

```text
CC3 publish exact payload → sign → deliver → validate → destination replay guard
```

The adapter uses one disclosed authorized EIP-191 relayer and is isolated behind `agent/src/relayer.ts`. The linked live evidence proves payload binding, delivery, validation and crash recovery; migrating to the official quorum replaces the signing/validation adapter without changing the proof-gated policy or recovery state machine.

## One-command evaluator

```bash
npm ci
npm run judge:verify
```

The five gates are:

1. TypeScript, 32 tests, production build and production audit;
2. 62 live cross-chain evidence checks;
3. two Sourcify creation/runtime exact matches;
4. a fresh multi-block shared batch proof and native `verifyBatch()`;
5. a fresh single proof and native `verifySingle()`.

Removing Attestcoin removes source authorization, canonical source identity, batch admission and every money-moving path. That dependency—not a count of imported methods—is the depth claim.
