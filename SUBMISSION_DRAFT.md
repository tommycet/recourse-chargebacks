# DoraHacks BUIDL Submission — Paste-Ready Form Filler

Copy-paste each field below into the DoraHacks submission form. This is NOT a replacement for SUBMISSION.md — it is the form text distilled for quick pasting.

---

## 1. Project Name

```
Recourse — Chargebacks for the Machine Economy
```

## 2. Short Description (1–2 sentences)

```
Recourse is a dispute-resolution escrow layer for autonomous agent payments. When an x402 payment goes wrong, our 4-agent pipeline evaluates the evidence and executes a chargeback onchain through KeeperHub — no human needed.
```

## 3. GitHub URL

```
https://github.com/tommycet/recourse-chargebacks
```

## 4. Demo Video Filename

```
demo-video-final-v2.mp4
```

## 5. Transaction Link (Blockscout)

```
https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0
```

## 6. Contract Address

```
0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2  (RecourseEscrow on Sepolia)
```

## 7. KeeperHub Wallet Address

```
0x32db418d6442ad9746e17ad6f72686dad3d8b4af  (EIP-7702 smart account)
```

## 8. KeeperHub Surfaces Used (3)

```
1. MCP Server — agent-native tool discovery via @modelcontextprotocol/sdk, calls execute_contract_call
2. Direct Execution API — HTTP fallback (POST /api/execute/contract-call), simulate-then-execute
3. CLI Wrapper — kh execute contract-call via keeperhub-cli-client.ts, Direct API fallback if CLI unavailable
```

## 9. Key Metrics

```
137/137 Foundry tests passing | 4-agent pipeline (evidence-verifier → arbiter → policy-agent → KeeperHub) | Real Sepolia tx: 0x6ad71f82… at block 11374381 via KeeperHub execution 7z0t2yr9…
```

---

**Reminder:** This file is a paste-helper. The authoritative submission document is SUBMISSION.md in this repo.