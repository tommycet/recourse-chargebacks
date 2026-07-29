# Recourse | Chargebacks for the Machine Economy

**The dispute-resolution and escrow layer for autonomous x402 agent payments. AI arbiter decides → KeeperHub executes onchain.**

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)](https://soliditylang.org)
[![Foundry](https://img.shields.io/badge/Foundry-137%2F137%20tests-orange)](https://book.getfoundry.sh)
[![Network](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io)
[![Execution](https://img.shields.io/badge/Execution-KeeperHub-blueviolet)](https://docs.keeperhub.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Live Onchain Proof

Our AI arbiter evaluated a dispute and executed the resolution **through KeeperHub** — a real signed transaction on Sepolia, not a mockup.

| Field | Value |
|---|---|
| **Tx Hash** | `0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0` |
| **Blockscout** | [→ view transaction](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0) |
| **Block** | 11,374,381 |
| **KeeperHub Execution ID** | `7z0t2yr9ecczhx0tfgad6` |
| **KeeperHub Audit Run** | [→ view on KeeperHub](https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6) |
| **Call** | `RecourseEscrow.resolveDispute(3, true, 0x7532…)` |
| **Result** | `Resolved` event emitted — buyer wins, 9.9 USDC refunded |

Full recorded output: [`agent/src/keeperhub-demo-output.json`](agent/src/keeperhub-demo-output.json)

---

## The Problem: x402 Has No Safety Net

The HTTP 402 payment protocol lets autonomous agents buy API access, compute, and data — machines paying machines at internet scale. But the spec has a critical flaw.

From [x402 Protocol Specification v2, §2](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md): the payment flow goes *request → payment required → payment authorization → settlement*. **Nowhere is there a dispute, delivery verification, or chargeback mechanism.** Once `/settle` broadcasts, the payment is final — even if the seller delivered nothing.

x402 treats "no chargebacks" as a feature. That's the gap: **irreversibility is exactly why no serious buyer will route non-trivial value through these rails.** Card networks solved this in 1974. No one has rebuilt it for the machine economy.

---

## The Solution: Escrow + Evidence + AI Arbiter + KeeperHub

Recourse closes the accountability gap with four layers:

1. **Escrow-first settlement** — Funds lock in `RecourseEscrow.sol` at payment time. No release until delivery is confirmed or a dispute resolves.

2. **Cryptographic evidence bundles** — Request + response hashes committed onchain at transaction time. Tamper-proof audit trail, producible in any dispute.

3. **AI arbiter at machine speed** — Evaluates both evidence bundles against the service contract, issues a verdict (buyerWins/sellerWins) in seconds, not weeks. Rule-based fallback ensures determinism even without an LLM key.

4. **KeeperHub execution layer** — The arbiter's verdict triggers a KeeperHub call that executes `resolveDispute()` onchain. KeeperHub handles gas, nonce management, and MEV protection — and produces a full audit trail (trigger → execution ID → tx hash → confirmation).

**The agent decides. KeeperHub executes. That's the last mile.**

---

## Multi-Agent Pipeline

Recourse resolves disputes through a **4-phase pipeline** — each phase is a purpose-specific agent. Together they validate evidence, issue verdicts, enforce policy, and execute onchain through KeeperHub.

```
evidence-verifier → arbiter → policy-agent → KeeperHub (onchain)
```

| Phase | Agent | What It Does |
|-------|-------|--------------|
| **1. Evidence Verification** | `evidence-verifier` | Validates cryptographic evidence bundles — hash integrity, timestamps, and signature chains. Tampered bundles are rejected before reaching the arbiter. |
| **2. Arbitration** | `arbiter` (LLM + rule-based) | Evaluates verified evidence against the service contract. Issues a binary verdict (`buyerWins`/`sellerWins`) with a confidence score. Falls back to deterministic rules when no LLM key is available. |
| **3. Policy Enforcement** | `policy-agent` | Verifies the verdict against escrow constraints — policy limits, challenge windows, and contract state invariants. Halts any invalid execution. |
| **4. Onchain Execution** | **KeeperHub** | Signs and broadcasts `resolveDispute()` on Sepolia through KeeperHub's EIP-7702 smart account. Dual-surface (MCP → Direct API fallback), retry with exponential backoff (2/4/8 s), complete audit trail. |

Future direction: full x402 protocol integration with escrow header injection (`X-Escrow-Contract`). See [`docs/x402-integration-design.md`](docs/x402-integration-design.md) for the design.

---

## KeeperHub Integration — Two Surfaces

Recourse uses **two** KeeperHub surfaces with automatic failover. The arbiter tries the MCP server first (agent-native), then falls back to the Direct Execution API (HTTP).

| Surface | Role | Code |
|---------|------|------|
| **MCP Server** (`https://app.keeperhub.com/mcp`) | Agent-native tool discovery via `@modelcontextprotocol/sdk` — calls `execute_contract_call` to run `resolveDispute()` | `agent/src/keeperhub-mcp.ts` |
| **Direct Execution API** (`POST /api/execute/contract-call`) | HTTP fallback — single REST call with contract address, ABI, function args. Simulate-then-execute preflight before broadcasting | `agent/src/keeperhub-arbiter.ts` |

### Reliability Features

| Feature | Implementation |
|---------|----------------|
| **Retry with backoff** | Exponential backoff (2 s → 4 s → 8 s) on HTTP 429, 5xx, gas spikes, timeouts. Up to 3 retries. |
| **Simulate-then-execute** | Every `resolveDispute()` is pre-flighted with `simulate: true`. If it would revert, execution halts — no wasted gas. |
| **Gas spike awareness** | KeeperHub's Smart Gas Estimation adapts to congestion; our retry layer re-attempts on detected gas spikes. |
| **Audit trail** | Execution ID, tx hash, block number, KeeperHub run URL, onchain verification (escrow status + payout address + balance). |

### Routing Logic

```
Arbiter verdict issued
  │
  ├─► MCP health check
  │     ├─ healthy → execute via MCP (execute_contract_call tool)
  │     └─ unavailable → fall through
  │
  ├─► Direct Execution API
  │     ├─ simulate: true (preflight)
  │     │    └─ wouldRevert → halt, return "simulated" status
  │     └─ broadcast
  │
  └─► Retry on transient failure (429/5xx/gas/timeout) with exp backoff
```

Full integration guide: [`docs/keeperhub-integration.md`](docs/keeperhub-integration.md)

---

## How It Works

```
  Buyer Agent ──x402 payment──► RecourseEscrow (funds locked)
                                    │
                        seller delivers? ──yes──► confirmDelivery() ──► release to seller
                                    │
                                    no
                                    │
                                    ▼
                              raiseDispute()
                                    │
                       evidence bundles (onchain hashes)
                                    │
                                    ▼
                              AI Arbiter
                       (evaluates evidence vs service spec)
                                    │
                                    ▼
                         verdict: buyerWins / sellerWins
                                    │
                                    ▼
                      KeeperHub executes resolveDispute()
                         (MCP → Direct API fallback)
                                    │
                                    ▼
                         Onchain resolution on Sepolia
```

1. **Agent initiates payment** — Buyer agent sends x402 payment. Funds deposit into `RecourseEscrow`, not directly to seller.
2. **Seller delivers (or doesn't)** — Seller submits a signed evidence bundle (request hash + response hash + delivery attestation), committed as `bytes32` onchain.
3. **Buyer verifies** — If delivery confirmed, buyer calls `confirmDelivery()` → funds release immediately. If not, buyer calls `raiseDispute()` within the challenge window.
4. **Arbiter resolves** — AI arbiter evaluates both bundles, verifies onchain hashes, scores delivery quality, issues verdict. KeeperHub executes `resolveDispute()` onchain. **Under 60 seconds.**

---

## Multi-Agent Arbitration Pipeline

Recourse uses a 4-phase multi-agent pipeline with KeeperHub as the shared execution primitive:

```
Phase 1: Evidence Verifier Agent
  │  Validates hash format, address format, delivery status coherence,
  │  and buyer/seller distinctness. Rule-based (no LLM dependency).
  │
  ▼ PASS
Phase 2: AI Arbiter (LLM or rule-based fallback)
  │  Evaluates evidence against rulebook.json. Issues verdict:
  │  buyerWins/sellerWins + confidence score + reasoning.
  │
  ▼
Phase 3: Policy Agent
  │  Applies rulebook policy rules. Critiques the arbiter's verdict.
  │  Can BLACKBALL (block) the verdict or adjust confidence/decision.
  │  Prevents: low-confidence buyer wins on no evidence, seller wins
  │  on clear non-delivery, overconfident partial-delivery rulings.
  │
  ▼ APPROVED
Phase 4: KeeperHub Onchain Execution
     MCP server (try first) → Direct Execution API (fallback)
     simulate → broadcast → audit trail
```

| Agent | File | Role |
|-------|------|------|
| Evidence Verifier | `agent/src/evidence-verifier-agent.ts` | Validates bundle integrity |
| AI Arbiter | `agent/src/arbiter-llm.ts` | LLM verdict with rule-based fallback |
| Policy Agent | `agent/src/arbiter-policy-agent.ts` | Rulebook enforcement + blackball |
| KeeperHub Executor | `agent/src/keeperhub-arbiter.ts` | Onchain execution via MCP + Direct API |

See also our [x402 Protocol Integration Design](docs/x402-integration-design.md) — how Recourse adds chargeback protection to the x402 payment flow.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Smart Contracts** | Solidity 0.8.20 + Foundry — 137/137 tests passing |
| **Execution Layer** | KeeperHub MCP Server + Direct Execution API (dual-surface, auto-failover) |
| **Evidence Bundles** | `keccak256` + ABI encoding, committed onchain |
| **Arbiter** | TypeScript + LLM evaluation (rule-based fallback) |
| **Wallet** | KeeperHub agentic wallet (EIP-7702 smart account, Turnkey enclave — no plaintext key) |
| **Payment** | x402 with onchain escrow (Sepolia USDC) |
| **Demo UI** | HTML/CSS + ethers.js (connects to Sepolia) |
| **Network** | Ethereum Sepolia (live contracts) |

---

## Live Contracts (Sepolia)

| Contract | Address | Explorer |
|----------|---------|----------|
| **RecourseEscrow** | `0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2` | [Sepolia Etherscan](https://sepolia.etherscan.io/address/0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2) |
| **MockUSDC** | `0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA` | [Sepolia Etherscan](https://sepolia.etherscan.io/address/0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA) |
| **Arbiter** | `0x7532A98C8eA413157787C8D2dA9659cD86D3acCe` | — |
| **KeeperHub Wallet** | `0x32db418d6442ad9746e17ad6f72686dad3d8b4af` | — |

---

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- Node.js 18+
- A KeeperHub API key (for onchain execution)

### Build & Test

```bash
git clone https://github.com/tommycet/recourse-chargebacks
cd recourse
forge install
forge build
forge test -vv    # 137/137 pass
```

### Run the KeeperHub Demo

```bash
# Set your KeeperHub API key
echo "KEEPERHUB_API_KEY=kh_your_key_here" >> .env

# Run the full pipeline: arbiter → KeeperHub simulate → onchain execute
cd agent/src
npx tsx keeperhub-demo.ts

# View the recorded output (tx hash, execution ID, audit URL)
cat keeperhub-demo-output.json
```

### Demo UI

```bash
cd web/
python3 -m http.server 8080
# Open http://localhost:8080 — connects to Sepolia
```

The UI walks through: connect wallet → mint test USDC → create escrow → confirm/dispute → arbiter resolves → funds move.

---

## Reproducibility

The recorded live run in `agent/src/keeperhub-demo-output.json` contains:

- Full dispute input (escrow ID, evidence hashes, buyer/seller addresses)
- Verdict (buyerWins=true, confidence=0.9, reasoning)
- Execution details (tx hash, block, KeeperHub execution ID, audit URL)
- Onchain verification (escrow status = Resolved, payout address, contract balance = 0)

Verify on Blockscout: [tx `0x6ad71f82…`](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0) — look for the `Resolved` event and USDC transfer to the buyer.

---

## Repo Structure

```
recourse/
├── contracts/
│   ├── src/RecourseEscrow.sol            — escrow + dispute state machine
│   └── test/RecourseEscrow.t.sol         — 137 Foundry tests
├── middleware/src/
│   ├── evidenceBundle.ts                 — cryptographic evidence spec
│   ├── evidenceVerifier.ts               — hash verification
│   └── recourseClient.ts                 — client SDK
├── agent/src/
│   ├── keeperhub-arbiter.ts              — MCP + Direct API integration
│   ├── keeperhub-mcp.ts                  — MCP server surface
│   ├── keeperhub-demo.ts                 — demo runner
│   ├── keeperhub-demo-output.json         — recorded live run
│   ├── arbiter-llm.ts                    — LLM + rule-based verdict engine
│   └── arbiter-runner.ts                 — dispute scenario runner
├── docs/
│   ├── evidence-bundle-spec.md           — cryptographic spec
│   ├── keeperhub-integration.md         — full integration guide
│   └── architecture.svg                  — system diagram
└── web/
    ├── index.html                        — landing page
    └── demo.html                         — live demo UI
```

---

## Why This Matters Now

The x402 protocol is being adopted faster than the infrastructure around it can mature. Every week, more autonomous agents are authorized to spend real money on behalf of real users and businesses. Every week, the attack surface in the x402 settlement flow grows.

Recourse is not a theoretical fix. It's a deployed, working system — with a live Sepolia transaction executed through KeeperHub — that proves the safety model is possible without changing the x402 spec, without slowing down payments, and without requiring human intervention.

**The machine economy needs chargebacks. We built them.**

---

## Roadmap

1. **x402 spec integration** — Submit an EIP-style proposal to add an optional `X-Escrow-Contract` header for drop-in adoption.
2. **Reputation oracle** — Aggregate dispute outcomes into an onchain seller reputation score.
3. **Multi-asset support** — Extend `RecourseEscrow` to any ERC-20 (USDC, USDT, DAI, WETH).
4. **Decentralized arbiter network** — Staked multi-node arbitration with threshold signatures.
5. **Mainnet deployment** — Ethereum mainnet + Optimism/Base L2s, with an optional insurance pool.

---

## License

MIT © 2025 Recourse Contributors
