# Recourse — Chargebacks for the Machine Economy

The buyer-protection and dispute-resolution layer for agent payments. Escrowed settlement, cryptographic evidence bundles, and an AI arbiter that resolves disputes at machine speed.

**Hackathon:** [Agents Onchain (KeeperHub)](https://dorahacks.io/hackathon/agents-onchain/detail) — deadline 2026-08-13.

## Why this exists

Visa's moat was never the card network — it was the dispute system. The agent economy has payments (x402, 165M+ txs) and no dispute layer. a16z named "liability: who bears the cost when an agent-initiated transaction is reversed" as one of their three unsolved agent-payment problems — and it is the only one without a funded startup behind it. Coinbase's own x402 issue #1645 admits that `/settle` executes blockchain transfer with zero delivery verification. Recourse is the missing institution.

## Architecture

```
contracts/src/RecourseEscrow.sol   — escrowed settlement on Base (8453) using USDC
middleware/src/evidence.ts         — evidence-bundle primitives (keccak256 hash-committed, <1KB)
middleware/src/index.ts             — drop-in Express middleware wrapping any x402 endpoint
agent/src/arbiter.ts                — Tier-0 (auto-verify) + Tier-1 (AI arbiter in TEE)
agent/src/rulebook.json             — public rulebook (v1.0) — no hidden model weights
web/index.html                      — landing page (anti-slop: dark editorial, no Inter/indigo)
video/recourse_demo_final.mp4       — real demo video with Edge TTS narration
```

## Quickstart

```bash
# Smart contracts (Foundry)
cd contracts && forge install && forge test

# Middleware (TypeScript)
cd middleware && npm install && npm run build

# Demo video
cd video && open recourse_demo_final.mp4
```

## The demo flow (Agents Onchain judging bar)

1. Agent creates an escrow backed by Base USDC via `RecourseEscrow.createEscrow()`.
2. x402 endpoint is wrapped by `recourseWrap()` middleware — every payment emits a signed evidence bundle.
3. Buyer raises dispute with failure proof (contentDigest mismatch).
4. Tier-0 instant verification finds contentDigest mismatch → buyer wins.
5. Arbiter executes `resolveDispute(escrowId, true, buyer)` via **KeeperHub** `web3/write-contract` MCP action — **a real USDC refund transaction on Base**.
6. Dispute outcome (with txHash) feeds the reputation flywheel — sybil-resistant by construction.

## What survives the kill board

| Candidate | Verdict |
|---|---|
| Agent wallet firewall | Killed — Turnkey/Crossmint/CDP/Safe |
| Billing for agent products | Killed — Nevermined/Skyfire/Payman/$9.5M |
| DeFi defensive security | Wounded — Hypernative ($65M) | 
| FICO for agents (KYA) | Wounded — AsterPay/ScoutScore/Qova |
| AI AAC | Wounded — LENO/TinyBridge/IncluVoice |
| Smallholder carbon MRV | Wounded — Boomitra/Varaha/CarbonKhet |
| **Dispute / buyer protection** | **SURVIVED — empty everywhere we looked** |
