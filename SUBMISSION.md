# Recourse | Chargebacks for the Machine Economy

**The dispute resolution and escrow layer for autonomous x402 agent payments — executed onchain through KeeperHub.**

---

## One-Liner

Recourse gives autonomous AI agents the same chargeback protections humans have had since 1974: cryptographic evidence bundles, AI-powered arbitration, and onchain verdict execution via KeeperHub.

---

## Problem

The HTTP 402 payment protocol enables autonomous agent payments via USDC on Base. But it has a critical accountability gap.

From [x402 Protocol Specification v2, §2 Core Payment Flow](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md):

The x402 specification defines a 4-step payment flow: request → payment required → payment authorization → settlement. Nowhere in the spec is there a dispute, delivery verification, or chargeback mechanism. Once `/settle` broadcasts the blockchain transfer, the payment is final — even if the seller delivered nothing.

x402 explicitly treats "no chargebacks" as a feature. That's the gap: **irreversibility is exactly why no serious buyer will route non-trivial value through these rails.** Card networks learned this in 1974. No one has rebuilt it for the machine economy.

---

## Solution

Recourse closes the gap with four layers:

1. **Escrow-first settlement** — Funds lock in `RecourseEscrow.sol` at payment time. No release until delivery is confirmed or a dispute resolves.

2. **Cryptographic evidence bundles** — Request + response hashes committed onchain at transaction time. Tamper-proof audit trail.

3. **AI arbiter** — The arbiter evaluates evidence against the service contract and issues a verdict (buyerWins/sellerWins) in seconds.

4. **KeeperHub execution layer** — The arbiter's verdict triggers a KeeperHub Direct Execution API call that executes `resolveDispute()` onchain. KeeperHub handles gas, nonce management, and produces an audit trail (trigger → execution ID → tx hash → confirmation).

This is exactly the "last mile" KeeperHub solves: the agent decides, KeeperHub acts.

---

## KeeperHub Integration

The entire onchain execution path routes through KeeperHub:

| Stage | KeeperHub surface |
|-------|-------------------|
| Dispute verdict delivery | Webhook trigger — arbiter POSTs `{ escrowId, buyerWins }` |
| State verification | `web3/read-contract` — reads `getEscrow(escrowId)` to confirm DISPUTED status |
| Conditional routing | Condition node — only execute if status == DISPUTED |
| Onchain resolution | `web3/write-contract` — calls `resolveDispute(escrowId, buyerWins)` |
| Observability | KeeperHub audit trail — trigger, simulation, tx hash, gas used, outcome |

**Live KeeperHub execution:** See `agent/src/keeperhub-demo-output.json` for a recorded run.

**Transaction hash (executed via KeeperHub):** [`0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0`](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0) — Sepolia block 11374381, KeeperHub smart account (EIP-7702 at `0x32Db...b4AF`) called `resolveDispute(3, true, 0x7532...)`. `Resolved` event emitted: buyer wins, 9.9 USDC refunded.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Smart Contracts** | Solidity 0.8.20 + Foundry — 28/28 tests |
| **Execution Layer** | KeeperHub Direct Execution API (contract-call → resolveDispute) |
| **Evidence Bundles** | `keccak256` + ABI encoding, committed onchain |
| **Arbiter** | TypeScript + LLM evaluation (rule-based fallback) |
| **Wallet** | KeeperHub agentic wallet (Turnkey enclave, no plaintext key) |
| **Payment** | x402 on Base USDC (via KeeperHub agentic wallet) |
| **Demo UI** | HTML/CSS + ethers.js |
| **Network** | Ethereum Sepolia (live contracts) |

---

## Live Contracts (Sepolia)

- **RecourseEscrow**: [`0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2`](https://sepolia.etherscan.io/address/0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2)
- **MockUSDC**: [`0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA`](https://sepolia.etherscan.io/address/0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA)

---

## Judging Criteria — Self-Assessment

| Criterion | Status |
|-----------|--------|
| Executes onchain via KeeperHub | ✅ [`0x6ad71f82...`](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0) — block 11374381, `resolveDispute(3)` via KeeperHub |
| Uses KeeperHub surfaces | ✅ Direct Execution API (contract-call), web3/read-contract + write-contract, audit trail |
| Reliability + observability | ✅ Retry with exponential backoff (2s/4s/8s) on transient failures (429, gas spikes, 5xx), simulate-then-execute safety gate, KeeperHub audit trail (execution ID + tx hash + run URL), 28/28 Foundry tests |
| Originality + real-world usefulness | ✅ Addresses documented gap in x402 (§2), first working implementation |
| Integration quality + DX | ✅ Drop-in `keeperhub-arbiter.ts`, clean evidence bundle spec, 28-test Foundry suite |

---

## Repo Structure

```
recourse/
├── contracts/src/RecourseEscrow.sol   — escrow + dispute state machine
├── contracts/test/RecourseEscrow.t.sol — 28 Foundry tests
├── middleware/src/evidenceBundle.ts    — cryptographic evidence spec
├── agent/src/keeperhub-arbiter.ts      — KeeperHub-integrated arbiter
├── agent/src/keeperhub-demo.ts         — end-to-end demo runner
├── agent/src/keeperhub-demo-output.json — recorded run (exec ID + tx hash)
├── docs/evidence-bundle-spec.md        — cryptographic spec
├── docs/keeperhub-integration.md       — KeeperHub workflow guide
└── web/
    ├── index.html                      — landing page
    └── demo.html                       — live demo UI (Sepolia)
```

---

**Built for KeeperHub - Agents Onchain. The agent decides. KeeperHub executes.**
