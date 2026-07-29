# KeeperHub × Recourse Integration Guide

> **Hackathon:** Agents Onchain (DoraHacks)  
> **Deadline:** August 13, 2026, 12:00 UTC+2  
> **Prize pool:** $5,000 — execution via KeeperHub is the #1 judging criterion  
> **Gas sponsorship:** KeeperHub offers gas sponsorship on mainnet Ethereum  

---

## TL;DR

Recourse resolves disputes. KeeperHub executes the resolution onchain. Two integration paths:

1. **Direct Execution API** (fastest to demo) — single `POST /api/execute/contract-call` simulates then broadcasts `resolveDispute()` to Sepolia
2. **Workflow API** (best for judging "depth of integration") — full webhook → read → condition → write pipeline with audit trail

**Winner strategy:** Build both. Direct Execution for the live demo. Workflow for the audit-trail screenshot that judges love.

---

## 0. Prerequisites

### Sign Up & Keys

```bash
# 1. Sign up at https://app.keeperhub.com
# 2. Go to Settings > API Keys > Organisation → create a kh_ key
# 3. Go to Settings > API Keys (user-level) → create a wfb_ key
# 4. Copy both keys

export KH_API_KEY="kh_your_org_key_here"
export KH_WEBHOOK_KEY="wfb_your_user_key_here"
```

### Recourse Contract (already deployed)

```
Contract:  0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2
Chain:     Sepolia (11155111)
USDC:      0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA
Arbiter:   0x7532A98C8eA413157787C8D2dA9659cD86D3acCe
RPC:       https://ethereum-sepolia-rpc.publicnode.com
```

### Key ABI Functions

| Function | Signature | Mutability |
|---|---|---|
| `escrows(uint256)` | Returns struct: buyer, seller, amount, taskId, evidenceBundleHash, createdAt, delivered, disputed, resolved, disputeRaisedAt, payoutTo | `view` |
| `statusOf(uint256)` | Returns `uint8` (0=CREATED, 1=PAID, 2=DISPUTED, 3=RESOLVED) | `view` |
| `resolveDispute(uint256 id, bool buyerWins, address payoutTo)` | **3 params** — resolves dispute and sends funds | `nonpayable` |

> ⚠️ **Critical correction:** `resolveDispute` takes `uint256 id` (not `bytes32 escrowId`), and includes a third parameter `address payoutTo`. The task description had the signature wrong — the on-chain contract is the source of truth.

---

## Path A: Direct Execution API (Fastest Demo)

This is the simplest integration — one HTTP call, one transaction. Perfect for the live demo.

### A1. Discover Available Chains

```bash
curl -s https://app.keeperhub.com/api/chains \
  -H "Authorization: Bearer $KH_API_KEY" | jq '.data[] | select(.chainId == 11155111)'
```

Verify Sepolia has `"isEnabled": true` and `"isTestnet": true`.

### A2. Simulate the Resolve (Safe Pre-Flight)

```bash
# Simulate resolveDispute — no gas spent, no tx broadcast
curl -X POST https://app.keeperhub.com/api/execute/contract-call \
  -H "Authorization: Bearer $KH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2",
    "chainId": 11155111,
    "functionName": "resolveDispute",
    "functionArgs": "[42, true, \"0x7532A98C8eA413157787C8D2dA9659cD86D3acCe\"]",
    "abi": "[{\"type\":\"function\",\"name\":\"resolveDispute\",\"inputs\":[{\"name\":\"id\",\"type\":\"uint256\"},{\"name\":\"buyerWins\",\"type\":\"bool\"},{\"name\":\"payoutTo\",\"type\":\"address\"}],\"outputs\":[],\"stateMutability\":\"nonpayable\"}]",
    "simulate": true
  }'
```

Expected response:
```json
{
  "data": {
    "success": true,
    "wouldRevert": false
  }
}
```

### A3. Broadcast the Transaction

```bash
# Same payload, no simulate field — actually broadcasts
curl -X POST https://app.keeperhub.com/api/execute/contract-call \
  -H "Authorization: Bearer $KH_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: recourse-resolve-escrow-42-$(date +%s)" \
  -d '{
    "contractAddress": "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2",
    "chainId": 11155111,
    "functionName": "resolveDispute",
    "functionArgs": "[42, true, \"0x7532A98C8eA413157787C8D2dA9659cD86D3acCe\"]",
    "abi": "[{\"type\":\"function\",\"name\":\"resolveDispute\",\"inputs\":[{\"name\":\"id\",\"type\":\"uint256\"},{\"name\":\"buyerWins\",\"type\":\"bool\"},{\"name\":\"payoutTo\",\"type\":\"address\"}],\"outputs\":[],\"stateMutability\":\"nonpayable\"}]"
  }'
```

Expected response (202 Accepted):
```json
{
  "data": {
    "executionId": "direct_abc123",
    "status": "completed"
  }
}
```

### A4. Check Execution Status & Get Transaction Hash

```bash
curl -s https://app.keeperhub.com/api/execute/direct_abc123/status \
  -H "Authorization: Bearer $KH_API_KEY" | jq '.data'
```

```json
{
  "status": "completed",
  "transactionHash": "0xdead...beef",
  "transactionLink": "https://sepolia.etherscan.io/tx/0xdead...beef"
}
```

### A5. Verify Escrow Status On-Chain

```bash
# Confirm the escrow is now RESOLVED (status == 3)
curl -X POST https://app.keeperhub.com/api/execute/contract-call \
  -H "Authorization: Bearer $KH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2",
    "chainId": 11155111,
    "functionName": "statusOf",
    "functionArgs": "[42]"
  }'
```

Response: `"result": "3"` → RESOLVED ✅

---

## Path B: Workflow API (Full Audit Trail — Best for Judging)

This creates a complete multi-node workflow with read → condition → write. The audit trail (every action logged: trigger, simulation, submission, gas, outcome) is a **bonus judging point**.

### B1. Create the Workflow

```bash
curl -X POST https://app.keeperhub.com/api/workflows/create \
  -H "Authorization: Bearer $KH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Recourse Dispute Resolver",
    "description": "Receives dispute resolution via webhook, verifies escrow is disputed, then executes resolveDispute() on Sepolia. Part of the Recourse chargeback system for x402 AI agent payments.",
    "enabled": true,
    "nodes": [
      {
        "id": "trigger",
        "type": "trigger",
        "data": {
          "label": "Dispute Webhook",
          "config": {
            "triggerType": "Webhook"
          }
        }
      },
      {
        "id": "read-escrow",
        "type": "action",
        "data": {
          "label": "Read Escrow Status",
          "config": {
            "actionType": "web3/read-contract",
            "network": "11155111",
            "contractAddress": "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2",
            "functionName": "statusOf",
            "functionArgs": "[{{trigger.escrowId}}]",
            "abi": "[{\"type\":\"function\",\"name\":\"statusOf\",\"inputs\":[{\"name\":\"id\",\"type\":\"uint256\",\"internalType\":\"uint256\"}],\"outputs\":[{\"name\":\"\",\"type\":\"uint8\",\"internalType\":\"enum RecourseEscrow.Status\"}],\"stateMutability\":\"view\"}]"
          }
        }
      },
      {
        "id": "check-disputed",
        "type": "action",
        "data": {
          "label": "Is Disputed?",
          "config": {
            "actionType": "condition",
            "leftOperand": "{{read-escrow.result}}",
            "operator": "eq",
            "rightOperand": "2"
          }
        }
      },
      {
        "id": "resolve-dispute",
        "type": "action",
        "data": {
          "label": "Resolve Dispute Onchain",
          "config": {
            "actionType": "web3/write-contract",
            "network": "11155111",
            "contractAddress": "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2",
            "functionName": "resolveDispute",
            "functionArgs": "[{{trigger.escrowId}}, {{trigger.buyerWins}}, \"0x7532A98C8eA413157787C8D2dA9659cD86D3acCe\"]",
            "abi": "[{\"type\":\"function\",\"name\":\"resolveDispute\",\"inputs\":[{\"name\":\"id\",\"type\":\"uint256\",\"internalType\":\"uint256\"},{\"name\":\"buyerWins\",\"type\":\"bool\",\"internalType\":\"bool\"},{\"name\":\"payoutTo\",\"type\":\"address\",\"internalType\":\"address\"}],\"outputs\":[],\"stateMutability\":\"nonpayable\"}]"
          }
        }
      }
    ],
    "edges": [
      { "id": "trigger->read-escrow", "source": "trigger", "target": "read-escrow" },
      { "id": "read-escrow->check-disputed", "source": "read-escrow", "target": "check-disputed" },
      { "id": "check-disputed->resolve-dispute", "source": "check-disputed", "target": "resolve-dispute", "sourceHandle": "true" }
    ]
  }'
```

Response:
```json
{
  "data": {
    "id": "wf_abc123",
    "name": "Recourse Dispute Resolver",
    ...
  }
}
```

### B2. Trigger via Webhook

```bash
curl -X POST "https://app.keeperhub.com/api/workflows/wf_abc123/webhook" \
  -H "Authorization: Bearer $KH_WEBHOOK_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: recourse-dispute-42-$(date +%s)" \
  -d '{
    "escrowId": 42,
    "buyerWins": true
  }'
```

> **Note:** Webhook endpoints use the user-scoped `wfb_` key, NOT the `kh_` key.

### B3. Wait for Execution Receipt

```bash
# Using the wait endpoint (blocking, up to 60s)
curl -s "https://app.keeperhub.com/api/workflows/executions/{executionId}/wait?timeoutMs=30000" \
  -H "Authorization: Bearer $KH_API_KEY" | jq '.data'
```

Or poll status:
```bash
curl -s "https://app.keeperhub.com/api/workflows/executions/{executionId}/status" \
  -H "Authorization: Bearer $KH_API_KEY" | jq '.data'
```

Response:
```json
{
  "status": "success",
  "nodeStatuses": [
    { "nodeId": "trigger", "status": "success" },
    { "nodeId": "read-escrow", "status": "success" },
    { "nodeId": "check-disputed", "status": "success" },
    { "nodeId": "resolve-dispute", "status": "success" }
  ],
  "progress": { "totalSteps": 4, "completedSteps": 4, "percentage": 100 },
  "transactionHashes": [
    {
      "hash": "0xdead...beef",
      "nodeId": "resolve-dispute",
      "nodeName": "Resolve Dispute Onchain",
      "chainId": 11155111,
      "network": "sepolia"
    }
  ]
}
```

### B4. View Execution History (Audit Trail Screenshot)

```bash
curl -s "https://app.keeperhub.com/api/workflows/wf_abc123/executions" \
  -H "Authorization: Bearer $KH_API_KEY" | jq '.data'
```

---

## Path C: MCP Integration (Agent-Native)

For deeper integration where the AI arbiter agent calls KeeperHub natively:

### C1. Add KeeperHub MCP Server

```bash
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp \
  --header "Authorization: Bearer $KH_API_KEY"
```

### C2. Per-Workflow MCP (Best Selection Accuracy)

After creating the workflow, its slug is available at `/mcp/w/{slug}`:

```bash
claude mcp add --transport http recourse-resolver https://app.keeperhub.com/mcp/w/recourse-dispute-resolver \
  --header "Authorization: Bearer $KH_API_KEY"
```

The agent sees a single typed tool with the exact input schema — no discovery dance needed.

### C3. Agent Code Integration

```python
# In the arbiter agent's resolve logic:
import requests

KH_BASE = "https://app.keeperhub.com/api"
KH_KEY = os.environ["KH_API_KEY"]

def resolve_via_keeperhub(escrow_id: int, buyer_wins: bool):
    """Execute dispute resolution via KeeperHub Direct Execution."""
    # Step 1: Simulate
    sim = requests.post(f"{KH_BASE}/execute/contract-call", headers={
        "Authorization": f"Bearer {KH_KEY}",
        "Content-Type": "application/json"
    }, json={
        "contractAddress": "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2",
        "chainId": 11155111,
        "functionName": "resolveDispute",
        "functionArgs": json.dumps([escrow_id, buyer_wins, ARBITER_ADDRESS]),
        "abi": json.dumps(RESOLVE_DISPUTE_ABI),
        "simulate": True
    }).json()

    if not sim["data"]["success"] or sim["data"].get("wouldRevert"):
        raise RuntimeError(f"Simulation failed: {sim}")

    # Step 2: Broadcast with idempotency
    import uuid
    tx = requests.post(f"{KH_BASE}/execute/contract-call", headers={
        "Authorization": f"Bearer {KH_KEY}",
        "Content-Type": "application/json",
        "Idempotency-Key": f"rescue-{escrow_id}-{uuid.uuid4()}"
    }, json={
        "contractAddress": "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2",
        "chainId": 11155111,
        "functionName": "resolveDispute",
        "functionArgs": json.dumps([escrow_id, buyer_wins, ARBITER_ADDRESS]),
        "abi": json.dumps(RESOLVE_DISPUTE_ABI)
    }).json()

    execution_id = tx["data"]["executionId"]

    # Step 3: Wait for receipt
    receipt = requests.get(
        f"{KH_BASE}/execute/{execution_id}/status",
        headers={"Authorization": f"Bearer {KH_KEY}"}
    ).json()

    return receipt["data"]["transactionHash"]
```

---

## Hackathon-Optimal Integration Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Recourse AI Arbiter                       │
│  1. Receives dispute (evidence bundle + escrowId)            │
│  2. Evaluates cryptographic evidence                         │
│  3. Decides: buyerWins = true/false                          │
│  4. Calls KeeperHub ──────────────────────────────────┐      │
└────────────────────────────────────────────────────────│──────┘
                                                         │
                    ┌────────────────────────────────────▼──┐
                    │         KeeperHub Platform             │
                    │                                       │
                    │  ┌─────────────────────────────────┐  │
                    │  │  Simulation Phase                │  │
                    │  │  • Simulates resolveDispute()    │  │
                    │  │  • Verifies ABI, balance, state  │  │
                    │  └──────────────┬──────────────────┘  │
                    │                 │ wouldRevert=false    │
                    │  ┌──────────────▼──────────────────┐  │
                    │  │  Execution Phase                 │  │
                    │  │  • Smart gas estimation           │  │
                    │  │  • MEV-protected submission      │  │
                    │  │  • Automatic retries             │  │
                    │  └──────────────┬──────────────────┘  │
                    │                 │                      │
                    │  ┌──────────────▼──────────────────┐  │
                    │  │  Audit Trail                    │  │
                    │  │  • trigger → simulate → tx hash  │  │
                    │  │  • gas used, outcome, timestamp  │  │
                    │  │  • Every step logged             │  │
                    │  └─────────────────────────────────┘  │
                    └─────────────────────┬──────────────────┘
                                          │
                    ┌─────────────────────▼──────────────────┐
                    │  Sepolia (11155111)                     │
                    │  RecourseEscrow.resolveDispute()        │
                    │  0x8c0c5c07c2ae79492da903c2b0a62aa48   │
                    │  → USDC transferred to winner           │
                    └────────────────────────────────────────┘
```

---

## Gas Sponsorship

Per the hackathon docs:

> **Gas sponsorship:** KeeperHub offers gas sponsorship on mainnet Ethereum.

For Sepolia testnet, you need ETH in your KeeperHub wallet. Top it up via:
- Sepolia faucet → send to your KeeperHub wallet address (visible at app.keeperhub.com > Profile > Wallet)
- For mainnet, gas is sponsored by KeeperHub — no ETH needed in the wallet

---

## Auth Blockers & Notes

| Blocker | Resolution |
|---|---|
| Need `kh_` API key for workflow CRUD | Create at Settings > API Keys > Organisation |
| Need `wfb_` key for webhook triggers | Create at Settings > API Keys (user-level) |
| `kh_` key rejected on webhook endpoint | By design — use `wfb_` key for webhooks |
| Browser OAuth required for MCP | Use API key header instead of OAuth for headless/CI |
| Sepolia wallet needs ETH | Top up from faucet; mainnet gas is sponsored |

---

## Demo Script (5-Minute Judging Presentation)

1. **Show the dispute** — buyer agent created escrow, seller didn't deliver, buyer raised dispute with evidence
2. **Show the arbiter** — AI evaluated evidence bundle, decided buyer wins
3. **Live execute** — Run `curl` command or script that calls KeeperHub
4. **Show the transaction hash** — Sepolia etherscan link with resolveDispute() call
5. **Show the audit trail** — KeeperHub execution log showing: trigger → simulation → transaction → gas used → outcome
6. **Emphasize** — "The entire dispute resolution pipeline runs through KeeperHub. No manual wallet interaction. No private keys in the arbiter. KeeperHub handled gas estimation, MEV protection, and retries automatically."

---

## Quick Reference: All KeeperHub API Endpoints Used

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| `GET` | `/api/chains` | Verify Sepolia is available | `kh_` |
| `POST` | `/api/execute/contract-call` | Simulate + execute resolveDispute | `kh_` |
| `GET` | `/api/execute/{executionId}/status` | Poll tx status | `kh_` |
| `POST` | `/api/workflows/create` | Create full workflow | `kh_` |
| `POST` | `/api/workflows/{id}/webhook` | Trigger workflow | `wfb_` |
| `GET` | `/api/workflows/{id}/executions` | Audit trail history | `kh_` |
| `GET` | `/api/workflows/executions/{id}/status` | Workflow execution status | `kh_` |
| `GET` | `/api/workflows/executions/{id}/wait` | Blocking wait for completion | `kh_` |
