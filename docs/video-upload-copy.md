# Demo Video Upload Pack

Use this file when publishing the checked 2:29 AttestFlow review cut. Upload the existing artifacts without re-encoding them unless the platform rejects the source file.

## Upload files

- Video: `docs/attestflow-demo-review.mp4`
- Captions: `docs/attestflow-demo-review.srt`
- Thumbnail: `docs/attestflow-demo-poster.png`

## Title

```text
AttestFlow — Proof-Gated Cross-Chain Payments | BUIDL CTC 2026
```

## Description

```text
AttestFlow turns a natural-language payment rule into a proof-gated Creditcoin settlement, then carries the exact on-chain result back to the source chain.

The live public-testnet path shown here is:
1. A client pays 0.01 ETH on Ethereum Sepolia.
2. Attestcoin proves the source transaction to a deployed ASC on Creditcoin CC3.
3. The ASC derives the proof-bound transaction index, checks receipt status, policy, replay state and escrow, then releases 0.001 CTC.
4. The exact published payload executes back on Sepolia behind a second replay guard.

Public transactions:
Source payment: https://sepolia.etherscan.io/tx/0x6ac68ba923494389999206236504123521d8ecdb9463f60aa52da47d59d555e7
CC3 settlement: https://creditcoin-testnet.blockscout.com/tx/0xec29d5b4046d5557c014d6720e6d3799ba0f0b41e31a71147240a09b89c2e4c2
Sepolia delivery: https://sepolia.etherscan.io/tx/0xc692a176f78b1541104e9e0a18f9a8404c585b15e9be2c695df3d118796947fb

Reproduce the full verdict:
git clone https://github.com/ximilu0114-droid/ximilu-hackson.git
cd ximilu-hackson
npm ci
npm run judge:verify

Project links:
Repository: https://github.com/ximilu0114-droid/ximilu-hackson
Pitch deck: https://github.com/ximilu0114-droid/ximilu-hackson/blob/main/docs/attestflow-pitch-deck.pdf
Integration guide: https://github.com/ximilu0114-droid/ximilu-hackson/blob/main/docs/integration.md

Honest boundary: Creditcoin's official Writability Outbox/Inbox contracts are not deployed on the target testnet. The return leg therefore uses an isolated adapter with one authorized relayer; it proves destination binding, exact-payload delivery, replay protection and crash recovery, but does not claim attestor-quorum security.

Third-party services: the Attestcoin hosted prover, configurable public Sepolia and CC3 RPC endpoints, public block explorers, and an optional OpenAI-compatible endpoint that is disabled by default. The checked review cut uses the local macOS Samantha voice and no external voice service.

All currencies and deployments shown are testnet-only.

Chapters:
0:00 Live two-chain outcome
0:16 Natural language to bounded policy
0:37 Attestcoin-gated CC3 settlement
0:53 Defense in depth beyond proof inclusion
1:11 The exact payload closes the loop
1:25 Honest Writability boundary and crash recovery
1:45 Reproduce the 62-check verdict
2:11 AttestFlow close
```

## Tags

```text
AttestFlow, Attestcoin, Creditcoin, Creditcoin CC3, cross-chain payments, autonomous agents, AI agents, Solidity, Ethereum Sepolia, smart contract escrow, BUIDL CTC 2026, DoraHacks
```

## Upload settings

- Visibility: start as **Unlisted**; keep Unlisted or switch to Public only after the signed-out acceptance check.
- Language: English.
- Captions: upload `docs/attestflow-demo-review.srt` even though captions are also burned into the review cut.
- Thumbnail: upload `docs/attestflow-demo-poster.png`.
- Audience: mark according to the platform's factual audience setting; this technical hackathon demo is not child-directed content.
- Allow processing to reach 1080p before copying the final URL.

## Signed-out acceptance

Use a private browser window with no account session:

- [ ] The URL opens without authentication or an access request.
- [ ] 1080p playback is available and the total duration is approximately 2:29.
- [ ] Audio starts immediately and remains intelligible at normal speed.
- [ ] Burned-in captions remain readable; the uploaded caption track can also be enabled.
- [ ] All eight chapter links seek to the correct scenes.
- [ ] The thumbnail is visible before playback.
- [ ] The description preserves the Writability limitation and all three transaction links.
- [ ] Copy the final URL into `docs/submission-copy.md` and `docs/submission-checklist.md`.

## Integrity manifest

| Artifact | Expected properties | SHA-256 |
|---|---|---|
| `attestflow-demo-review.mp4` | H.264 + AAC · 1920×1080 · 30 fps · 149.110 s · 7,700,098 bytes | `1b93f85db1ee8152b85b66e8efe3caeb5e4f68a48681a48040c9795786d788d6` |
| `attestflow-demo-review.srt` | 8 caption blocks | `64183fc31da99165f634227c7c54ae743b33460851b5a4deda02fadbf2c24dc2` |
| `attestflow-demo-poster.png` | PNG · 1920×1080 · 477,471 bytes | `a33dee25b0ee04279a4cec76a2fdef7e146acf0dd9bed2860854b256b92a9857` |

If an upload platform re-encodes the video, use the runtime, visual, audio and signed-out checks rather than expecting the hosted copy to retain the local SHA-256.
