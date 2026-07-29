# x402 Integration Design — Recourse × KeeperHub

> **Status:** Design document (not yet implemented)
> **Goal:** Demonstrate deep x402 protocol understanding for KeeperHub Agents Onchain judges
> **Previous hackathon:** 40/180 winning projects used x402

---

## Overview

Recourse extends the x402 payment protocol with escrow and dispute resolution. This doc describes how Recourse integrates with x402's 4-step payment flow, using KeeperHub as the onchain execution layer for both payment AND dispute resolution.

## The x402 Payment Flow (Today)

```
HTTP 402 Protocol — Current Flow (No Dispute Protection)

  Buyer Agent                    Seller (Resource)
      │                               │
      │── GET /resource ─────────────►│
      │                               │
      │◄── 402 Payment Required ──────│
      │    {accepts: ["USDC@base"],   │
      │     maxAmountRequired: 0.01}  │
      │                               │
      │── POST /resource ────────────►│
      │    {x402-version: 1,          │
      │     payment: {signature...}}  │
      │                               │
      │◄── 200 OK + resource ─────────│
      │                               │
      │   (payment is FINAL —          │
      │    no chargeback possible)     │
```

## The Recourse-Enhanced Flow

```
Recourse × x402 — Chargebacks for Agent Payments

  Buyer Agent                    Seller (Resource)           KeeperHub
      │                               │                         │
      │── GET /resource ─────────────►│                         │
      │◄── 402 Payment Required ──────│                         │
      │                               │                         │
      │  ┌──────────────────────────────────────────────────┐   │
      │  │ RECURSE PROXY LAYER (buyer-side interceptor)     │   │
      │  │  1. Intercept 402 response                       │   │
      │  │  2. Create RecourseEscrow.createEscrow()          │   │
      │  │     (locks USDC in escrow, NOT direct payment)    │   │
      │  │  3. Submit escrow ID proof as x402 payment        │   │
      │  └──────────────────────────────────────────────────┘   │
      │                               │                         │
      │── POST /resource ────────────►│                         │
      │    {x402 payment proof +      │                         │
      │     escrowId: 42}              │                         │
      │                               │                         │
      │◄── 200 OK + resource ─────────│                         │
      │                               │                         │
      │  (if delivery OK)              │                         │
      │── confirmDelivery(42) ─────────────────────────────►│   │
      │     (releases USDC to seller)  │    KeeperHub executes  │
      │                               │                         │
      │  (if delivery FAILS)           │                         │
      │── raiseDispute(42) ────────────────────────────────►│   │
      │                               │                         │
      │  ═══ ARBITRATION PIPELINE ═══  │                         │
      │  Phase 1: Evidence verifier    │                         │
      │  Phase 2: AI Arbiter           │                         │
      │  Phase 3: Policy agent         │                         │
      │  Phase 4: KeeperHub executes ──────────────────────────►│
      │     resolveDispute(42, true, buyer)                     │
      │     (refunds USDC to buyer)                              │
```

## Architecture: Recourse as x402 Proxy

Recourse sits between the buyer agent and the seller as an HTTP proxy:

```
┌─────────────────────────────────────────────────────────────┐
│  Buyer Agent (any framework)                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Recourse HTTP Client (intercepts 402 responses)        │ │
│  │  • On 402: create escrow → submit escrow proof          │ │
│  │  • On 200: verify delivery → confirm or dispute         │ │
│  │  • On timeout: auto-dispute via KeeperHub                │ │
│  └────────────────┬───────────────────────────────────────┘ │
└───────────────────│──────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  Seller (x402-enabled resource)                              │
│  Returns 402 with payment requirements                       │
│  Accepts escrow proof as valid payment                       │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  KeeperHub (Onchain Execution Layer)                         │
│  • createEscrow() → escrow USDC                              │
│  • confirmDelivery() → release to seller                     │
│  • raiseDispute() → freeze escrow                            │
│  • resolveDispute() → arbiter verdict onchain               │
│  • autoRefund() → timeout refund                             │
│  All via MCP server or Direct Execution API                  │
└─────────────────────────────────────────────────────────────┘
```

## Onchain Flow: x402 + Recourse + KeeperHub

```
Timeline ─────────────────────────────────────────────────────────────►

[seller 402]    [escrow created]    [seller delivers]    [buyer confirms or disputes]
                                      │
                                      │ if delivery fails
                                      ▼
                              [raiseDispute onchain]
                                      │
                                      ▼
                              ┌───────────────┐
                              │ MULTI-AGENT    │
                              │ PIPELINE       │
                              │               │
                              │ 1. Evidence   │
                              │    Verifier   │
                              │ 2. AI Arbiter │
                              │ 3. Policy     │
                              │    Agent      │
                              │ 4. KeeperHub  │
                              │    executes   │
                              └───────┬───────┘
                                      │
                                      ▼
                              [resolveDispute tx]
                              via KeeperHub MCP
```

## x402 + KeeperHub Agentic Wallet

The KeeperHub agentic wallet (EIP-7702 smart account) serves dual purposes:

1. **x402 payment facilitator** — the wallet holds USDC, signs x402 payment authorizations, and creates RecourseEscrow contracts on behalf of the buyer agent
2. **Dispute resolver** — the wallet acts as the onchain arbiter, calling `resolveDispute()` when the multi-agent pipeline reaches a verdict

This means the agent never needs a separate wallet for payments vs dispute resolution — KeeperHub handles both through the same EIP-7702 smart account.

## Key Advantage for Judges

Recourse is the **first project to add chargeback protection to x402 payments**. The x402 spec (§2) explicitly treats "no chargebacks" as a feature — but irreversibility is why no serious buyer would route non-trivial value through these rails. Card networks learned this in 1974. Recourse brings it to the machine economy.

Combined with KeeperHub's execution layer, the entire flow is:
- **Agent-native** (MCP tools for createEscrow, confirmDelivery, resolveDispute)
- **Reliable** (retry backoff, simulate-then-execute, audit trail)
- **Autonomous** (no human in the loop — evidence verifier + arbiter + policy agent + KeeperHub)

## References

- [x402 Protocol Specification v2](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md)
- [KeeperHub MCP Server Docs](https://docs.keeperhub.com/ai-tools/mcp-server)
- [KeeperHub Agentic Wallet](https://docs.keeperhub.com/ai-tools/agentic-wallet)
- Our deployed contract: [`0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2`](https://sepolia.etherscan.io/address/0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2)
- Real tx: [`0x6ad71f82...`](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0)
