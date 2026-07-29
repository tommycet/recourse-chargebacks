# Recourse — Chargebacks for the Machine Economy

**The dispute-resolution and escrow layer for autonomous x402 agent payments — executed onchain through KeeperHub.**

> **GitHub:** https://github.com/tommycet/recourse-chargebacks
> **Hackathon:** KeeperHub - Agents Onchain (DoraHacks)
> **Network:** Ethereum Sepolia

---

## Transaction Proof

Our AI arbiter evaluated a dispute, issued a verdict (buyer wins), and executed `resolveDispute(3, true, 0x7532…)` onchain **through KeeperHub** — not a manual wallet, not a mockup. A real signed transaction on Sepolia.

| Field | Value |
|-------|-------|
| **Transaction Hash** | `0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0` |
| **Blockscout** | [eth-sepolia.blockscout.com/tx/0x6ad71f82…](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0) |
| **Block** | 11,374,381 |
| **KeeperHub Execution ID** | `7z0t2yr9ecczhx0tfgad6` |
| **KeeperHub Audit Run** | [app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6](https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6) |
| **Contract Called** | `RecourseEscrow.resolveDispute()` at `0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2` |
| **KeeperHub Wallet** | `0x32db418d6442ad9746e17ad6f72686dad3d8b4af` (EIP-7702 smart account) |
| **Outcome** | `Resolved` event emitted — buyer wins, 9.9 USDC refunded |

**Full JSON output from the live run:** [`agent/src/keeperhub-demo-output.json`](agent/src/keeperhub-demo-output.json)

---

## KeeperHub Surfaces Used

Recourse integrates **two** KeeperHub surfaces — the arbiter tries MCP first, then falls back to the Direct Execution API. This dual-surface architecture means the agent can execute even if one path is unavailable.

| # | Surface | How We Use It | Code |
|---|---------|---------------|------|
| 1 | **MCP Server** (`https://app.keeperhub.com/mcp`) | Agent-native tool discovery — connects via `@modelcontextprotocol/sdk`, calls `execute_contract_call` tool to run `resolveDispute()` onchain | `agent/src/keeperhub-mcp.ts` |
| 2 | **Direct Execution API** (`POST /api/execute/contract-call`) | HTTP fallback — single REST call with contract address, ABI, and function args. Simulate-then-execute pattern (preflight with `simulate: true` before broadcasting) | `agent/src/keeperhub-arbiter.ts` |

**Routing logic** (in `keeperhub-arbiter.ts`): MCP health check → if healthy, execute via MCP → if MCP fails or unavailable, execute via Direct API → retry transient failures with exponential backoff (2 s / 4 s / 8 s).

---

## Reliability & Observability

| Concern | Implementation |
|---------|----------------|
| **Retry on transient failures** | Exponential backoff (2 s → 4 s → 8 s) on HTTP 429, 5xx, gas spikes, timeouts, ECONNRESET. Up to 3 retries. |
| **Gas spike awareness** | KeeperHub's Smart Gas Estimation adapts to congestion; our retry layer re-attempts when gas spikes are detected. |
| **Simulate-then-execute** | Every `resolveDispute()` call is pre-flighted with `simulate: true` before broadcasting. If the simulation would revert, execution is halted — no wasted gas. |
| **Audit trail** | Every run captures: trigger timestamp → simulation result → execution ID → tx hash → block number → onchain verification (escrow status, payout address, contract USDC balance). Stored in `keeperhub-demo-output.json`. |
| **KeeperHub run URL** | `https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6` — full execution history viewable in the KeeperHub dashboard. |

---

## Judging Criteria — Self-Assessment

| # | Criterion | How We Address It |
|---|-----------|-------------------|
| 1 | **Executes onchain via KeeperHub** | ✅ Real Sepolia tx `0x6ad71f82…` at block 11,374,381. `resolveDispute(3, true, buyer)` called through KeeperHub's smart account. `Resolved` event emitted, 9.9 USDC refunded. [Blockscout proof](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0). |
| 2 | **KeeperHub surfaces** | ✅ MCP server (agent-native tool calls via SDK) **+** Direct Execution API (HTTP fallback). Two surfaces, automatic failover. |
| 3 | **Reliability & observability** | ✅ Retry with exponential backoff (2/4/8 s), simulate-then-execute safety gate, KeeperHub audit trail (execution ID + tx hash + run URL), onchain verification step. 28/28 Foundry tests pass. |
| 4 | **Originality & real-world usefulness** | ✅ First chargeback/dispute system for x402 agent payments. Addresses a documented spec gap (x402 §2 has no dispute mechanism). No other team in this hackathon is doing dispute resolution — we checked. |
| 5 | **Integration quality & DX** | ✅ Clean TypeScript integration (`keeperhub-arbiter.ts` + `keeperhub-mcp.ts`), drop-in evidence bundle spec, 28-test Foundry suite, interactive demo UI, step-by-step integration guide. |

---

## Project Structure

```
recourse/
├── contracts/
│   ├── src/RecourseEscrow.sol          — escrow + dispute state machine
│   └── test/RecourseEscrow.t.sol       — 28 Foundry tests (100% pass)
├── middleware/src/
│   ├── evidenceBundle.ts               — cryptographic evidence spec
│   ├── evidenceVerifier.ts             — hash verification
│   └── recourseClient.ts              — client SDK
├── agent/src/
│   ├── keeperhub-arbiter.ts            — KeeperHub-integrated arbiter (MCP + Direct API)
│   ├── keeperhub-mcp.ts                — MCP server surface
│   ├── keeperhub-demo.ts               — end-to-end demo runner
│   ├── keeperhub-demo-output.json      — recorded live run (tx hash + execution ID)
│   ├── arbiter-llm.ts                  — LLM + rule-based verdict engine
│   └── arbiter-runner.ts               — dispute scenario runner
├── docs/
│   ├── evidence-bundle-spec.md         — cryptographic spec
│   ├── keeperhub-integration.md        — full integration guide
│   └── architecture.svg                — system diagram
└── web/
    ├── index.html                      — landing page
    └── demo.html                       — live demo UI (Sepolia)
```

---

## Demo Video

**File:** `demo-video-final-v2.mp4` (72 seconds, 1.9 MB)

The demo shows the full pipeline: buyer creates escrow → seller fails to deliver → buyer opens dispute → AI arbiter evaluates evidence → verdict issued → KeeperHub executes `resolveDispute()` onchain → buyer refunded.

---

## Builder Feedback (Onboarding Bounty)

We documented our onboarding experience — what worked, where we got stuck, and proposed fixes — in pursuit of the $1,000 Best Onboarding UX Improvement bounty.

**Key findings:**
- Direct Execution API was the fastest path to a live tx (under 2 hours)
- Execution status endpoint needs improvement (tx hash not returned immediately)
- Direct API docs are thin compared to MCP/x402 docs
- Cloudflare Turnstile blocks headless auth for CI/CD

**Full feedback report:** `/tmp/keeperhub-builder-feedback.md`

---

## Live Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| **RecourseEscrow** | [`0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2`](https://sepolia.etherscan.io/address/0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2) |
| **MockUSDC** | [`0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA`](https://sepolia.etherscan.io/address/0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA) |
| **Arbiter (deployer)** | `0x7532A98C8eA413157787C8D2dA9659cD86D3acCe` |
| **KeeperHub wallet** | `0x32db418d6442ad9746e17ad6f72686dad3d8b4af` |

---

**The agent decides. KeeperHub executes. That's the whole pitch.**
