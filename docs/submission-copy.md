# DoraHacks Submission Copy — BUIDL CTC 2026 Fall

This file is ready to paste into the submission portal. Replace only the bracketed team and video fields. Do not shorten or soften the Writability disclosure.

## Project name

AttestFlow — Proof-Gated Cross-Chain Payments

## Sector

AI

## One-line description

A natural-language agent that proves external payments through Attestcoin, settles deterministic escrow on Creditcoin, and returns the exact settlement result cross-chain.

## Short pitch

AttestFlow gives a cross-border freelancer automatic escrow without trusting a bridge operator, payment indexer, or LLM. A client pays on Ethereum Sepolia; Attestcoin proves the exact transaction to a Creditcoin CC3 smart contract; the contract checks receipt success, policy, replay, and escrow before releasing CTC; and the exact published result is delivered back to Sepolia. The complete live path is public and independently re-verifiable with one command.

## Long description

Cross-chain payment automation has a truth problem. A user may want to say, “When I receive at least 0.01 ETH on Sepolia, release 10% on Creditcoin,” but an autonomous agent must not be trusted to claim that the payment happened. Existing automation commonly depends on a centralized indexer, bridge operator, or oracle report. Adding an LLM improves usability while making an unchecked truth path even more dangerous.

AttestFlow separates intent, truth, and execution.

1. **Intent:** a natural-language rule is compiled into an inspectable policy with an exact source chain, payee, asset, threshold, payout ratio, beneficiary, and destination.
2. **Truth:** the agent watches only blocks already attested by Creditcoin and uses the official `@gluwa/usc-sdk` `ProofBuilder` to obtain the transaction Merkle proof and source-chain continuity proof.
3. **Execution:** a deployed Attestcoin Smart Contract on CC3 calls the native BlockProver precompile. It derives the transaction index from the Merkle path, decodes the attested transaction and receipt, checks `status == 1`, verifies recipient and amount against the stored policy, rejects replay, checks escrow, and only then releases CTC.
4. **Return:** the settlement publishes a destination-bound payload. The agent checkpoints the irreversible CC3 result, delivers those exact bytes to a validating Sepolia Inbox, and can recover the missing destination leg after a crash without settling twice.

The initial product wedge is cross-border freelance escrow. The client pays on the chain where liquidity already exists; the freelancer receives an automatic Creditcoin-side release only after the exact external payment is proven. The same primitive can support marketplace escrow, invoice factoring, treasury automation, and agent-to-agent commerce.

Attestcoin is load-bearing, not decorative. The project uses the live ChainInfo precompile to validate that Sepolia `chainId 11155111` maps to `chainKey 1`, the hosted ProofBuilder for real proofs, BlockProver `verify()` inside every settlement, `calculateTxIndex()` for proof-bound identity, and protocol encoding v1 for source transaction and receipt checks. Removing Attestcoin removes the only path that can authorize settlement.

AI is deliberately bounded. Natural language reduces policy-authoring friction and supports questions over settlement history. An optional OpenAI-compatible model is disclosed, but the default deterministic parser keeps the demo reproducible. Whether parsing is local or model-assisted, no AI output can bypass proof verification, receipt success, policy matching, replay protection, or escrow solvency.

The repository contains a linked live result across two public testnets:

- Sepolia client payment: `0x6ac68ba923494389999206236504123521d8ecdb9463f60aa52da47d59d555e7`
- Creditcoin CC3 proof-gated settlement: `0xec29d5b4046d5557c014d6720e6d3799ba0f0b41e31a71147240a09b89c2e4c2`
- Sepolia execution of the same payload: `0xc692a176f78b1541104e9e0a18f9a8404c585b15e9be2c695df3d118796947fb`

`npm run verify:evidence` re-reads both public chains and performs 62 assertions, including chain identity, deployment provenance, policy fields, source receipt, settlement events, both replay guards, cross-chain payload equality, and deployed runtime bytecode equality with the local Solidity build. The repository also ships 28 automated tests, CI, CodeQL, a production build, a five-page evidence whitepaper, and a dedicated `/judge` view.

### Honest Writability boundary

The official Writability Outbox/Inbox contracts are not deployed on the target testnet at submission time. AttestFlow therefore implements the documented publish → sign → deliver → validate interface with one authorized EIP-191 relayer and `InboxDemo`. This proves destination binding, exact-payload delivery, replay protection, and crash recovery, but it does not claim attestor-quorum security. The adapter is isolated so that the official Writability contracts can replace it when available without changing the proof-gated settlement policy.

AttestFlow's core claim is inspectable rather than promotional: one real source payment, one Attestcoin-gated CC3 settlement, one integrity-bound return message, and a verifier any judge can rerun.

## Attestcoin integration summary

AttestFlow uses the live ChainInfo registry, `ProofBuilder`, Merkle and continuity proofs, the native BlockProver `verify()` and `calculateTxIndex()`, and protocol encoding v1 inside a deployed CC3 ASC. The ASC independently enforces receipt success, proof-index binding, policy match, replay protection, escrow, and a destination-bound payload. Because official Writability Outbox/Inbox contracts are not deployed on the target testnet, the return leg is explicitly labeled as a four-stage adapter using one authorized relayer rather than an attestor quorum.

## Technology

- Solidity + Hardhat on Creditcoin CC3 Testnet
- TypeScript + ethers v6 + `@gluwa/usc-sdk`
- Ethereum Sepolia source and destination testnet
- Next.js dashboard and judge evidence view
- Optional OpenAI-compatible rule parsing and history Q&A

## Public links

- Repository: https://github.com/ximilu0114-droid/ximilu-hackson
- ASC on CC3: https://creditcoin-testnet.blockscout.com/address/0x4E7410Ebf41C213378E1D8aA4423323303086bF6
- InboxDemo on Sepolia: https://sepolia.etherscan.io/address/0x83A0b8D26Dd28094eE0CA74E57e79028194f868E
- Whitepaper: `docs/whitepaper.pdf` in the repository
- Integration guide: `docs/integration.md` in the repository
- Demo video: [FINAL PUBLIC OR UNLISTED VIDEO URL]

## Third-party service disclosure

AttestFlow uses the Attestcoin hosted prover, configurable public Sepolia and CC3 RPC endpoints, and Etherscan/Creditcoin explorers for public evidence links. An OpenAI-compatible endpoint is optional and disabled by default. All core verification, settlement, tests, and recorded evidence work without an LLM API key.

## Originality declaration

This submission is original work created for BUIDL CTC 2026 Fall. It uses and discloses open-source dependencies including `@gluwa/usc-sdk`, ethers, Hardhat, Next.js, and their transitive dependencies. No third-party proprietary source code is included.

## Team fields — human completion required

- Legal name: [REQUIRED]
- Email: [REQUIRED]
- Country of residence: [REQUIRED]
- Citizenship/nationality: [REQUIRED]
- Role: [REQUIRED]
- Short bio: [REQUIRED]
- Optional Telegram/X/LinkedIn: [IF REQUESTED]

The team member must personally review and accept every eligibility, sanctions, criminal-record, tax, and originality declaration in the portal.
