# AttestFlow Security Model

AttestFlow is an unaudited testnet prototype. It moves testnet assets only and
must not be used to custody production funds.

## Trust boundaries

| Component | Trusted for | Not trusted for |
|---|---|---|
| Attestcoin BlockProver precompile | Source-chain inclusion and continuity | Transaction success or application policy |
| Hosted proof service | Liveness and proof delivery | Correctness; invalid proofs fail on CC3 |
| Public RPC providers | Availability and transport | Settlement authorization |
| ASC owner/operator | Policy creation, escrow funding, proof submission | Bypassing proof, status, index, replay, or policy checks |
| Demo writability relayer | One authorized signature until the official Inbox is deployed | Attestcoin quorum security |

## Enforced invariants

1. `verify()` must accept the source transaction proof on CC3.
2. `calculateTxIndex()` must derive the same index supplied by the operator.
3. The attested receipt status must equal `1`.
4. The attested calldata/value must match the configured token, payee and minimum.
5. `(chainKey, height, proof-derived txIndex)` can settle only once.
6. Escrow accounting is updated before the beneficiary call and a failed call
   reverts the whole settlement.
7. The relayer delivers the exact `MessagePublished` payload recovered from the
   CC3 receipt; reconstructed or mismatched payloads are rejected by the agent.
8. The destination Inbox rejects unauthorized signatures and payload replay.
9. A crash after CC3 settlement resumes from on-chain events and completes only
   the missing destination leg.

## Known limitations

- Creditcoin's official Writability Outbox/Inbox contracts are not deployed on
  the testnet used by this project. `InboxDemo` uses one authorized relayer in
  place of attestor-quorum validation.
- The contracts have not received a professional audit or formal verification.
- The JSON agent state is designed for one process on a demo machine, not
  horizontally scaled production workers.
- Native-payment discovery scans a bounded incremental block window. A known
  older attested payment should be processed with `--tx 0x...`.
- The deterministic natural-language parser supports a deliberately small rule
  grammar. Optional external LLM parsing is disclosed and does not authorize
  settlement by itself.

## Verification

```bash
npm ci
npm run ci
npm run verify:evidence
```

The evidence verifier re-reads both public testnets, checks all three receipts,
compares the CC3 payload with the Sepolia execution hash, checks both replay
guards, and compares deployed runtime bytecode with the local Solidity build.

Please report vulnerabilities through a private GitHub security advisory when
available. Do not include private keys, seed phrases, or funded credentials.
