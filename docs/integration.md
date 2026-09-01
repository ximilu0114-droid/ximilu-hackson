# Attestcoin Protocol Integration — Technical Deep-Dive

This document maps each protocol primitive to shipped code and public evidence. It also states what Attestcoin proves, what AttestFlow must still enforce, and where the current Writability testnet boundary lies.

## 1. Trust boundary

AttestFlow never asks the agent or an LLM to attest that a payment happened. A CC3 settlement succeeds only if the native BlockProver accepts the source proof and the ASC's deterministic checks accept the attested transaction bytes.

| Claim | Enforcement owner |
|---|---|
| Source transaction belongs to the confirmed source chain | Attestcoin Merkle + continuity proof, checked by BlockProver |
| Operator supplied the transaction's true Merkle index | BlockProver `calculateTxIndex()` + ASC equality check |
| Source transaction execution succeeded | AttestFlow receipt decoder, `status == 1` |
| Payment matches recipient, asset, calldata, and threshold | AttestFlow policy matcher |
| Source transaction has never settled before | AttestFlow proof-derived replay key |
| Payout and destination cannot be redirected by the agent | On-chain policy |
| Return payload is the exact CC3-published payload | Receipt extraction + payload decode + cross-chain hash check |

## 2. Readability

### 2.1 ChainInfo registry

The protocol `chainKey` is not the EVM `chainId`. On startup, the agent queries the ChainInfo precompile through `PrecompileChainInfoProvider.getSupportedChains()` and fails closed unless the live registry maps Ethereum Sepolia (`chainId = 11155111`) to configured `chainKey = 1`.

The gas-free proof smoke test in `scripts/e2e-proof.ts` also uses:

- `getSupportedChains()` to discover Sepolia;
- `getLatestAttestedHeightAndHash(chainKey)` to pick a provable block;
- `waitUntilHeightAttested(chainKey, blockNumber)` for a caller-specified fresh transaction.

The observed `chainName` field is hex-encoded on CC3 with SDK 0.18.0, so it is not treated as an authorization value.

### 2.2 Attestation-aware discovery

The autonomous watcher reads `GET /api/v1/attested-height/1` and scans only the already-attested source window. This avoids a demo-time polling stall without weakening verification: every matched payment still receives a new `ProofBuilder.getProof(txHash)` result and must pass the on-chain precompile.

Discovery is intentionally narrow:

- ERC-20 rules query only `Transfer` logs whose indexed recipient is the rule payee, then cross-check the transaction calldata;
- native rules inspect only direct value transfers to the explicit payee;
- a deterministic `--tx 0x…` path bypasses discovery only, not proof generation or settlement.

### 2.3 Proof generation

`ProofBuilder.getProof(txHash)` returns the protocol `ContinuityResponse`:

- `txBytes`: ABI-encoded transaction and receipt using encoding v1;
- `merkleProof`: root plus ordered sibling path;
- `continuityProof`: lower endpoint digest plus attested roots;
- `headerNumber`, service-reported `txIndex`, and cache metadata.

Before submitting, the agent independently derives the transaction index from the sibling directions and rejects any disagreement with the service response.

### 2.4 Synchronous ASC verification

`AttestFlowASC.settle()` calls the native BlockProver at `0x0000000000000000000000000000000000000FD2`:

```solidity
require(
    BLOCK_PROVER.verify(
        chainKey,
        height,
        encodedTransaction,
        merkleProof,
        continuityProof
    ),
    "PROOF_INVALID"
);

uint64 proofTxIndex = BLOCK_PROVER.calculateTxIndex(merkleProof);
require(proofTxIndex == txIndex, "TX_INDEX_MISMATCH");
```

The index binding is security-critical. The precompile's `verify()` does not accept `txIndex` as an argument. Trusting a caller-supplied index in the replay key would allow the same valid proof to be resubmitted under a different key. The current deployment derives the canonical value from the verified Merkle path.

### 2.5 Empirical `verifyAndEmit()` result

On CC3 Testnet with SDK 0.18.0, an EOA call to `verifyAndEmitSingle` succeeded, while contract-context calls to `verifyAndEmit()` reverted without a reason. The ASC therefore uses the read-only `verify()` synchronously and emits its own domain events. This preserves the proof gate; only the redundant precompile event is omitted.

- EOA experiment: `0x6e24cef5b9974b6a181946100910b5fc60efa3dd5be307207ddd86d23c4d04c5`
- Current ASC settlement using in-contract `verify()`: `0xec29d5b4046d5557c014d6720e6d3799ba0f0b41e31a71147240a09b89c2e4c2`

### 2.6 Encoding v1 and transaction success

The precompile proves inclusion and source-chain continuity; it does not prove that source execution succeeded. The ASC decodes the receipt from the attested bytes and rejects `status != 1`.

`txBytes = abi.encode(uint8 txType, bytes[] chunks)`

| Chunk | Layout | Use |
|---|---|---|
| first | `(uint64 nonce, uint64 gasLimit, address from, bool toIsNull, address to, uint256 value, bytes data)` | payer, target, native value, ERC-20 calldata |
| middle | type-specific fee, signature, and access-list fields | not needed for policy matching |
| last | `(uint8 status, uint64 gasUsed, Log[] logs, bytes bloom)` | mandatory execution-success check |

Policy matching supports:

- native transfer: `to == payee && value >= minAmount`;
- ERC-20 `transfer(address,uint256)`;
- ERC-20 `transferFrom(address,address,uint256)`.

For token payments, the ASC requires `tx.to == policy.token`, the calldata recipient equals the stored payee, and the calldata amount meets the threshold. The agent mirrors the decoder and also requires the event amount to equal the calldata amount before requesting a proof.

## 3. ASC state transition

After proof acceptance and decoding, the settlement executes atomically:

1. load an active policy;
2. verify proof and bind proof-derived index;
3. reserve the proof-derived `sourceTxId = keccak256(chainKey, height, proofTxIndex)`;
4. require source receipt success;
5. match asset, payee, calldata, and amount;
6. compute the policy-fixed payout;
7. debit escrow and transfer CTC to the stored beneficiary;
8. emit `PaymentSettled`;
9. emit destination-bound `MessagePublished`.

A revert rolls back the replay reservation and every balance mutation. Policy creation rejects a zero payee, beneficiary, or destination, an unsafe decimal exponent, and a zero payout ratio. The owner remains responsible for the economic bounds of a policy; the agent's built-in and LLM parsers additionally require a payout percentage greater than 0 and at most 100%.

The current contract permits one policy per `(chainKey, payee, token)`. When that slot already exists, the agent compares every economic and routing field—including threshold, ratio, beneficiary, destination, decimals, and active state—and fails closed on any mismatch instead of silently reusing a stale rule.

## 4. Writability adapter and honest boundary

At the time of this submission, the official Writability Outbox/Inbox contracts are not deployed on the target testnet and the documentation describes the system as undergoing external testing and audits. AttestFlow implements the documented interface boundary so the return path can be demonstrated now without claiming quorum security that is unavailable.

| Protocol step | Official design | AttestFlow testnet adapter |
|---|---|---|
| publish | Creditcoin Outbox receives destination + payload | ASC emits `MessagePublished(destChainKey, destContract, payload)` |
| sign | attestor quorum signs the message | one authorized relayer signs `keccak256(payload)` using EIP-191 |
| deliver | permissionless relayer submits to destination Inbox | agent submits the exact receipt payload to `InboxDemo.execute` |
| validate | Inbox validates quorum and replay state | `InboxDemo` validates signer and payload replay |

The payload is:

```text
abi.encode(policyId, sourceTxId, amount, releasedAmount)
```

The agent never synthesizes a different live payload after settlement. It extracts `MessagePublished.payload` from the CC3 receipt, decodes all four fields, and checks them against the processed proof and payout before signing.

## 5. Failure recovery

Cross-chain work is not atomic, so the agent treats the two irreversible legs separately:

1. after CC3 settlement, persist the settlement immediately;
2. if Sepolia delivery times out, restart and query the ASC's `PaymentSettled` event;
3. re-read the settlement receipt and recover the exact `MessagePublished` bytes;
4. query `InboxDemo.executedPayloads(payloadHash)`;
5. deliver only if the payload has not executed.

The v2 live evidence exercised this path: CC3 settlement finalized before a Sepolia RPC timeout; retry recovered the on-chain payload, did not settle twice, and completed the destination leg.

## 6. Public evidence

| Artifact | Value |
|---|---|
| Source payment | `0x6ac68ba923494389999206236504123521d8ecdb9463f60aa52da47d59d555e7` |
| Source block / index | `11608703 / 69` |
| ASC deployment | `0x4E7410Ebf41C213378E1D8aA4423323303086bF6` |
| CC3 settlement | `0xec29d5b4046d5557c014d6720e6d3799ba0f0b41e31a71147240a09b89c2e4c2` |
| Proof-derived sourceTxId | `0x780a2c1665d5c3b62f3326cf745659376f3f566dd0b3ad645e16c44f2f28fd1a` |
| Published payload hash | `0x4845f5ca486987ddb30d486e58f36ed0cebbf5e514d20783d220b06f0d523faa` |
| Destination execution | `0xc692a176f78b1541104e9e0a18f9a8404c585b15e9be2c695df3d118796947fb` |

`npm run verify:evidence` re-reads both RPCs and checks 62 conditions, including:

- all three transaction statuses and source fields;
- proof-derived transaction identity;
- CC3 and destination events;
- decoded payload fields and cross-chain payload hash equality;
- ASC and Inbox replay states;
- deployed runtime bytecode equality with local compiled artifacts.

The canonical values are in `evidence/live-e2e-v2.json`; judges can inspect the same summary at `/judge`.

## 7. Test coverage and operational findings

- 15 Hardhat tests cover valid native/ERC-20 settlement, failed receipts, bad proofs, mismatched proof index, replay, policy mismatch, escrow, authorization, and destination validation.
- 8 agent tests cover encoding-v1 decoding, ERC-20 calldata variants, Merkle-index derivation, source transaction IDs, and fail-closed existing-policy reuse.
- 5 dashboard parser tests cover exact base-unit conversion, native/token selection, defaults, decimal precision, and payout boundaries.
- `npm run ci` also runs TypeScript checking, the production dashboard build, and a production dependency audit.

Measured implementation findings:

1. `verifySingle` is a gas-free `eth_call`; use it as a pre-flight check.
2. Attestation cadence makes newly mined blocks temporarily unprovable; scan the attested window or use `waitUntilHeightAttested`.
3. Ethers v6 may return block transaction entries as hash strings even when prefetch was requested.
4. Real Sepolia USDC activity uses `transferFrom` heavily and may emit `Transfer` from vault flows; validate calldata, not the event alone.
5. Hardhat's local fork cannot faithfully emulate the native `0x0FD2` precompile; contract tests install a purpose-built mock at the precompile address, while public-testnet evidence proves the real integration.
