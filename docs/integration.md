# Attestcoin Protocol Integration — Technical Deep-Dive

This document details every touchpoint between AttestFlow and the Attestcoin Protocol, at the level of functions, byte layouts, and on-chain evidence.

## 1. Readability: trustless ingestion of source-chain payments

### 1.1 Chain discovery

`agent/src/prover.ts` resolves the source chain through the **ChainInfo precompile** via `PrecompileChainInfoProvider.getSupportedChains()` against CC3 testnet. Observed registry:

| chainKey | chainId | chain |
|---|---|---|
| 1 | 11155111 | Ethereum Sepolia |
| 3 | 1 | Ethereum |

Note `chainName` is returned as a hex-encoded string (`0x5365706f6c6961…` = "Sepolia ethereum"); we decode before display.

### 1.2 Attestation-aware watching

The agent only scans blocks that are **already attested** on Creditcoin, using the prover service REST endpoint `GET /api/v1/attested-height/1`. This guarantees proof generation succeeds immediately (no 15-minute `waitUntilHeightAttested` stalls during demos) while remaining fully protocol-faithful: every settlement is still backed by a fresh proof.

### 1.3 Proof generation

`ProofBuilder.getProof(txHash)` against the hosted builder returns the full `ContinuityResponse`:

- `txBytes` — ABI-encoded `(uint8 txType, bytes[] chunks)` per encoding v1
- `merkleProof` — `{ root, siblings: [{hash, isLeft}] }`
- `continuityProof` — `{ lowerEndpointDigest, roots }`
- `headerNumber`, `txIndex`, `cached`

### 1.4 On-chain verification inside the ASC

`AttestFlowASC.settle()` calls the **BlockProver precompile at `0x…0FD2`**:

```solidity
bool verified = BLOCK_PROVER.verify(chainKey, height, encodedTransaction, merkleProof, continuityProof);
require(verified, 'PROOF_INVALID');
```

**Empirical finding (CC3 testnet, SDK 0.18.0):** contract-context calls to `verifyAndEmit()` revert without a reason string, while the identical call succeeds from an EOA, and `verify()` works from both. We therefore verify synchronously with `verify()` and emit our own events. The cryptographic guarantee is identical — same proofs, same precompile code path — minus the precompile's `TransactionVerified` event, which our design never consumed (the ASC emits `PaymentSettled` / `MessagePublished` itself).

Evidence of both paths working on-chain:
- EOA `verifyAndEmitSingle`: tx `0x6e24cef5b9974b6a181946100910b5fc60efa3dd5be307207ddd86d23c4d04c5`
- ASC `verify()` inside `settle()`: every settlement tx in `deployments/verified-txs.json`, e.g. `0x643fb17df1a491a9615f277842c018d87a931c8c485c60091ef5fb32a3e32cd4`

### 1.5 What the precompile does NOT prove — and how we compensate

The precompile proves *inclusion in a confirmed block*, not *success*. The attested bytes contain the receipt, so the ASC enforces the rest itself:

1. **Success status** — the last chunk of any tx type decodes as `(uint8 receiptStatus, uint64 gasUsed, Log[], bytes bloom)`; `require(status == 1)`.
2. **Replay protection** — `keccak256(chainKey, height, txIndex)` must be unseen (`settledTxs` map).
3. **Policy match** — decoded `to`/`value`/`data` must match a registered policy:
   - native: `to == payee && value ≥ minAmount`
   - ERC-20: `to == token` and calldata is `transfer(address,uint256)` (selector `0xa9059cbb`, 68 bytes) **or** `transferFrom(address,address,uint256)` (selector `0x23b872dd`, 100 bytes) with recipient `== payee` and amount `≥ minAmount`. (transferFrom dominates real Sepolia USDC traffic — supporting both doubled our match rate.)
4. **Escrow solvency** — `released ≤ escrowBalance`, released = `amount × payoutRatioE18 / 10^decimals`.

Each rule has a dedicated Hardhat test, including the adversarial path "proof valid but source tx failed" (`SOURCE_TX_FAILED`).

### 1.6 Decoding layout (encoding v1)

`txBytes = abi.encode(uint8 txType, bytes[] chunks)`

| chunk | layout | note |
|---|---|---|
| `chunks[0]` | `(uint64 nonce, uint64 gasLimit, address from, bool toIsNull, address to, uint256 value, bytes data)` | identical for tx types 0–4 |
| middle | type-specific signature/access-list fields | not needed by the ASC |
| last | `(uint8 status, uint64 gasUsed, (address,bytes32[],bytes)[] logs, bytes bloom)` | receipt; identical for all types |

The agent mirrors this decoder in TypeScript (`decodeTxBytes`) as a cross-check; both were validated against real SDK-produced bytes for tx types 2 (EIP-1559) and legacy transfers.

## 2. Writability: verified settlement messages back to Sepolia

Official status: the docs state writability is *"undergoing 3rd party testing and audits"* and no Outbox/Inbox addresses exist on CC3 testnet. We implemented the documented four-step semantics 1:1 so the loop closes today and the official contracts drop in later:

| Protocol step | Official (future) | AttestFlow today |
|---|---|---|
| 1. Publish | `Outbox.publish(dest, payload)` | `AttestFlowASC` emits `MessagePublished(destChainKey, destContract, abi.encode(policyId, sourceTxId, amount, released))` |
| 2. Sign | attestor quorum (⅔+1) over the message | relayer EIP-191 signature over `keccak256(payload)` |
| 3. Deliver | permissionless relayer → Inbox | agent relayer submits `(payload, signature)` to `InboxDemo.execute` |
| 4. Validate | Inbox verifies quorum against attestor set | `InboxDemo` recovers the signer and requires `== authorizedRelayer`, plus replay guard `executedPayloads` |

On-chain evidence: settlement `0x9c8caf6b…` (CC3) → `MessageExecuted` `0xd6abf721…` (Sepolia, block 11556106).

Swapping in the official stack later = replace step 2/3 with attestor signatures and point step 4 at the official Inbox; `MessagePublished` already carries the exact payload shape.

## 3. SDK surface used

- `chainInfo.PrecompileChainInfoProvider` — `getSupportedChains`, `getLatestAttestedHeightAndHash`
- `proofProvider.service.ProofBuilder` — `getProof`, `waitUntilHeightAttested`
- `blockProver.PrecompileBlockProver` — `verifySingle` (read-only sanity checks), `verifyAndEmitSingle` (EOA-path experiment)
- Prover REST — `/api/v1/attested-height/{chainKey}`

## 4. Operational learnings (for future builders)

1. `verifySingle` is an `eth_call` — free; use it liberally as a pre-flight check.
2. Attestation cadence means "just-mined" blocks are not immediately provable; scanning the attested window removes the wait entirely.
3. Contract-context `verifyAndEmit` reverts on CC3 testnet (see §1.4) — plan for `verify()` inside contracts.
4. Real Sepolia USDC activity is dominated by `transferFrom` and by vault contracts emitting `Transfer` without matching calldata; discovery must filter on calldata, not just events.
5. The prover service caches proofs (`cached=true` within minutes of attestation), making repeat demos cheap.
