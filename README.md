# AttestFlow — Cross-Chain Verified Payment Engine

> **AI agent that watches real payments on Ethereum Sepolia, proves them on Creditcoin with the Attestcoin Protocol, and settles automatically — then sends a verified message back.**

BUIDL CTC 2026 Fall submission (Track: **AI**).

[![Demo video](https://img.shields.io/badge/demo-video-blue)](DEMO_VIDEO_URL)
[![ASC on CC3 testnet](https://img.shields.io/badge/ASC-0x0cFd...374F-green)](https://explorer.cc3-testnet.creditcoin.network/address/0x0cFd2f6eBA1B2B8Af9C5a49c886b8F950594374F)

## What it does

A freelancer invoices a client in USDC on Ethereum Sepolia. The client pays. AttestFlow then — with **zero human intervention**:

```
Sepolia (source)                     Creditcoin CC3 (settlement)
────────────────                     ───────────────────────────
USDC transfer ≥ threshold
        │
        ▼
Agent watches the attested window
        │  1. inclusion proof via hosted prover
        │  2. BlockProver precompile 0x0FD2 verify()
        ▼
        └────────────────────────►  AttestFlowASC.settle()
                                       ├─ cryptographic verification
                                       ├─ receipt status == 1 check
                                       ├─ replay + policy match
                                       ├─ release escrowed CTC
                                       └─ emit MessagePublished
                                            │
        ┌───────────────────────────────────┘
        ▼  3. relayer signs payload (writability semantics)
Sepolia InboxDemo.execute(payload, sig)
        └─ verifies signer, executes → MessageExecuted event
```

**Live evidence (all on public testnets):**

| Step | Artifact |
|---|---|
| Source payment (real third-party USDC transfer) | `0x39091951e67085ba72f8047576c18d7a0c8e43ec155856db86e51a97fbad8d84` (Sepolia) |
| On-chain settlement on CC3 | [`0x9c8caf6ba81abd605c485d1e0ab732cb307dfb7b15794c719606abba710d25b6`](https://explorer.cc3-testnet.creditcoin.network/tx/0x9c8caf6ba81abd605c485d1e0ab732cb307dfb7b15794c719606abba710d25b6) |
| Verified message executed back on Sepolia | [`0xd6abf72128f57c52cbd95ec3a9a197fdabedd3747b43729628795d03035e9389`](https://sepolia.etherscan.io/tx/0xd6abf72128f57c52cbd95ec3a9a197fdabedd3747b43729628795d03035e9389) |

## Attestcoin Protocol integration

| Capability | How we use it |
|---|---|
| **Readability — transaction proving** | `@gluwa/usc-sdk` `ProofBuilder` (hosted prover) generates Merkle + continuity proofs for real Sepolia txs; `AttestFlowASC` verifies them **on-chain** via the `0x0FD2` precompile (`verify()`), synchronously inside `settle()`. |
| **Security beyond the precompile** | The precompile proves *inclusion*, not success. The ASC decodes the attested bytes (encoding v1: `(uint8, bytes[])`, receipt chunk carries `status`) and **rejects `status != 1`**, replays, and non-matching policies. Covered by dedicated tests. |
| **Writability — message passing** | Official Outbox/Inbox are **not yet deployed on testnet** (docs: "undergoing 3rd party testing and audits"). We implemented the identical four-step semantics: ASC emits `MessagePublished` → relayer signs → `InboxDemo` on Sepolia validates the signature and executes. The swap to official contracts is a drop-in once they ship (see `docs/integration.md`). |
| **ChainInfo precompile** | `PrecompileChainInfoProvider` resolves `chainKey` (Sepolia = `1` on CC3 testnet) at runtime; prover REST gives attested height. |

**Key empirical finding** (documented for the judges): on CC3 testnet, **contract-context calls to `verifyAndEmit()` revert**, while `verify()` (read-only) works from contracts and EOAs alike. Our ASC therefore uses synchronous `verify()` and emits its own events — cryptographically identical guarantees, single event source.

## Quickstart (from zero)

Requirements: Node ≥ 20, npm. No API keys needed for the default (deterministic) mode.

```bash
git clone <this repo> && cd attestflow
npm install                 # installs all workspaces

cp .env.example .env        # then set AGENT_PRIVATE_KEY (any fresh testnet wallet)
#   fund it: CC3 testnet CTC via Discord #token-faucet (/faucet address:0x…)
#            Sepolia ETH via https://cloud.google.com/application/web3/faucet/ethereum/sepolia
```

### 1. Prove a real Sepolia transaction on CC3 (no gas needed)

```bash
npm run e2e:proof
# → picks a recent attested Sepolia tx, generates a proof, verifies on-chain
#   {"verification": "SUCCESS", "txHash": "0x…", "blockNumber": …}
```

### 2. Full settlement loop

```bash
# dry run (no gas): real payment, real proof, local decode + policy simulation
npm run e2e:settle

# live (funded wallet): real settlement on CC3 testnet
npm run e2e:settle:live --prefix contracts
#   env: ASC_ADDRESS=0x0cFd2f6eBA1B2B8Af9C5a49c886b8F950594374F
```

### 3. Autonomous agent (natural-language rule → watch → settle → deliver)

```bash
# dry (default): everything except on-chain settlement
npm run start --prefix agent -- --rule "当我在 Sepolia 收到 ≥100 USDC 时，按 10% 释放" --once

# live: full autonomous loop with on-chain settlement + writability delivery
LIVE=1 ASC_ADDRESS=0x0cFd2f6eBA1B2B8Af9C5a49c886b8F950594374F \
INBOX_ADDRESS=0x83A0b8D26Dd28094eE0CA74E57e79028194f868E \
npm run start --prefix agent -- --rule "当我在 Sepolia 收到 ≥100 USDC 时，按 10% 释放" --once
```

The agent is crash-safe: cursor + per-tx dedupe live in `agent/state.json`; kill it (Ctrl-C) and rerun — it resumes without double-settling.

### 4. Dashboard

```bash
npm run dev --prefix web     # http://localhost:3100
# register rules, watch the match→proved→settled→delivered pipeline (5s polling),
# ask settlement history in natural language
```

### 5. Tests

```bash
npm run test:contracts       # 14 Hardhat tests incl. status!=1 / replay / bad-proof paths
npm run typecheck
```

## Deployed artifacts

| Item | Address / value |
|---|---|
| AttestFlowASC (CC3 testnet) | `0x0cFd2f6eBA1B2B8Af9C5a49c886b8F950594374F` |
| InboxDemo (Sepolia) | `0x83A0b8D26Dd28094eE0CA74E57e79028194f868E` |
| BlockProver precompile | `0x0000000000000000000000000000000000000FD2` (native) |
| ABI snapshots | `deployments/*.json` |

## Architecture

```
contracts/   Solidity: AttestFlowASC (settlement), InboxDemo (dest-side receiver), MockBlockProver (tests)
agent/       TypeScript agent: NL rule parsing, attested-window watcher, proof generation,
             on-chain settle, writability relayer; JSON state for crash recovery
web/         Next.js 14 + Tailwind dashboard (rules, pipeline stepper, NL Q&A)
docs/        whitepaper, integration deep-dive, demo script
scripts/     e2e-proof.ts (Phase-0 acceptance)
```

## Third-party services disclosure

- **QVAC**: not used. All AI inference is either deterministic (builtin parser/QA) or delegated to the LLM below.
- **LLM API (optional)**: if `OPENAI_API_KEY` is set, rule parsing and dashboard Q&A upgrade to an OpenAI-compatible chat completion endpoint. **Every demo in this repo runs fully without it** — the builtin deterministic engine is the default and was used for all recorded results.
- **Hosted prover** `https://prover.cc3-testnet.creditcoin.network`: official Creditcoin proof-builder service (part of the Attestcoin Protocol toolchain).
- **Public RPCs**: `ethereum-sepolia-rpc.publicnode.com`, `rpc.cc3-testnet.creditcoin.network`.
- **Etherscan/Creditcoin explorer**: linked for evidence only.

## Honest limitations

1. Writability uses our four-step adapter (ASC event → signed relayer → validating Inbox) because official contracts are not live on testnet yet; the interface mirrors the documented protocol so the swap is trivial.
2. The relayer signature in `InboxDemo` stands in for the attestor quorum (single authorized key). Quorum validation drops in with the official Inbox.
3. `verifyAndEmit()` is avoided inside the ASC due to the contract-context revert on CC3 testnet (see above); `verify()` provides identical verification.

## License

MIT
