# Recourse → Chargebacks for the Machine Economy

x402 lets agents pay agents. What it doesn't do is let anyone get their money back when the other side doesn't deliver. Recourse fixes that.

Escrow locks the funds. An AI arbiter reads the evidence. KeeperHub executes the verdict onchain. No human in the loop, no trust required.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)](https://soliditylang.org)
[![Foundry](https://img.shields.io/badge/Foundry-137%2F137%20tests-orange)](https://book.getfoundry.sh)
[![Network](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io)
[![Execution](https://img.shields.io/badge/Execution-KeeperHub-blueviolet)](https://docs.keeperhub.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Live onchain proof

Our AI arbiter evaluated a real dispute and executed the resolution through KeeperHub. Not a mockup, not a simulation. A signed transaction on Sepolia.

| Field | Value |
|---|---|
| Tx Hash | `0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0` |
| Blockscout | [view transaction](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0) |
| Block | 11,374,381 |
| KeeperHub Execution ID | `7z0t2yr9ecczhx0tfgad6` |
| KeeperHub Audit Run | [view on KeeperHub](https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6) |
| Call | `RecourseEscrow.resolveDispute(3, true, 0x7532…)` |
| Result | `Resolved` event emitted, buyer wins, 9.9 USDC refunded |

Full recorded output: [`agent/src/keeperhub-demo-output.json`](agent/src/keeperhub-demo-output.json)

---

## The problem

The HTTP 402 payment protocol lets autonomous agents buy API access, compute, and data. Machines paying machines at internet scale. The spec has a gap though.

From the [x402 spec v2, §2](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md): the payment flow goes request, payment required, payment authorization, settlement. Nowhere in there is a dispute mechanism, delivery verification, or chargeback. Once `/settle` broadcasts, the payment is final. Even if the seller delivered nothing.

x402 treats "no chargebacks" as a feature. Card networks solved this in 1974. Nobody has rebuilt it for the machine economy until now.

---

## How it works

Four layers, each doing one job:

1. **Escrow**. Funds lock in `RecourseEscrow.sol` at payment time. No release until delivery is confirmed or a dispute resolves.
2. **Evidence bundles**. Request and response hashes committed onchain at transaction time. Tamper-proof, producible in any dispute.
3. **AI arbiter**. Evaluates both evidence bundles against the service contract, issues a verdict in seconds. Has a rule-based fallback so it works even without an LLM key.
4. **KeeperHub**. The arbiter's verdict triggers `resolveDispute()` onchain. KeeperHub handles gas, nonce management, and MEV protection. Full audit trail from trigger to confirmation.

```
  Buyer Agent ──x402 payment──► RecourseEscrow (funds locked)
                                    │
                        seller delivers? ──yes──► confirmDelivery() ──► release to seller
                                    │
                                    no
                                    │
                              raiseDispute()
                                    │
                       evidence bundles (onchain hashes)
                                    │
                              AI Arbiter
                       (evaluates evidence vs service spec)
                                    │
                         verdict: buyerWins / sellerWins
                                    │
                      KeeperHub executes resolveDispute()
                         (MCP → Direct API fallback)
                                    │
                         Onchain resolution on Sepolia
```

---

## The 4-phase pipeline

Each phase is a separate agent. They validate evidence, issue verdicts, enforce policy, and execute onchain.

```
evidence-verifier → arbiter → policy-agent → KeeperHub (onchain)
```

| Phase | What it does |
|-------|-------------|
| **1. Evidence Verifier** | Validates hash integrity, timestamps, and signature chains. Tampered bundles get rejected before reaching the arbiter. Rule-based, no LLM dependency. |
| **2. AI Arbiter** | Evaluates evidence against the service contract. Issues `buyerWins` or `sellerWins` with a confidence score. Falls back to deterministic rules when no LLM key is available. |
| **3. Policy Agent** | Checks the verdict against escrow constraints: policy limits, challenge windows, contract state invariants. Can block invalid executions. |
| **4. KeeperHub** | Signs and broadcasts `resolveDispute()` on Sepolia through an EIP-7702 smart account. Three surfaces (MCP, Direct API, CLI) with retry and exponential backoff. |

| Agent | File |
|-------|------|
| Evidence Verifier | `agent/src/evidence-verifier-agent.ts` |
| AI Arbiter | `agent/src/arbiter-llm.ts` |
| Policy Agent | `agent/src/arbiter-policy-agent.ts` |
| KeeperHub Executor | `agent/src/keeperhub-arbiter.ts` |

---

## KeeperHub integration

Three surfaces with automatic failover. The arbiter tries the MCP server first (agent-native), falls back to the Direct Execution API (HTTP), with a CLI wrapper as third option.

| Surface | What it does | Code |
|---------|-------------|------|
| MCP Server | Agent-native tool discovery via `@modelcontextprotocol/sdk`. Calls `execute_contract_call` to run `resolveDispute()`. | `agent/src/keeperhub-mcp.ts` |
| Direct Execution API | HTTP fallback. Single REST call with contract address, ABI, function args. Simulate-then-execute preflight. | `agent/src/keeperhub-arbiter.ts` |
| CLI Wrapper | Wraps the Direct Execution API as a CLI surface, third integration path. | `agent/src/keeperhub-cli-client.ts` |

Reliability: exponential backoff (2s, 4s, 8s) on 429/5xx/gas spikes/timeouts, up to 3 retries. Every call is pre-flighted with `simulate: true` so it halts before wasting gas on a revert. Full audit trail: execution ID, tx hash, block number, KeeperHub run URL, onchain verification.

Full integration guide: [`docs/keeperhub-integration.md`](docs/keeperhub-integration.md)

---

## Tech stack

| Layer | What |
|-------|------|
| Smart contracts | Solidity 0.8.20 + Foundry, 137/137 tests passing |
| Execution | KeeperHub MCP + Direct API + CLI, three-surface auto-failover |
| Evidence | `keccak256` + ABI encoding, committed onchain |
| Arbiter | TypeScript + LLM evaluation with rule-based fallback |
| Wallet | KeeperHub agentic wallet (EIP-7702 smart account, Turnkey enclave, no plaintext key) |
| Payment | x402 with onchain escrow (Sepolia USDC) |
| Demo UI | HTML/CSS + ethers.js, connects to Sepolia |
| Network | Ethereum Sepolia |

---

## Live contracts (Sepolia)

| Contract | Address |
|----------|---------|
| RecourseEscrow | `0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2` |
| MockUSDC | `0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA` |
| Arbiter | `0x7532A98C8eA413157787C8D2dA9659cD86D3acCe` |
| KeeperHub Wallet | `0x32db418d6442ad9746e17ad6f72686dad3d8b4af` |

---

## Quick start

You need [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`), Node.js 18+, and a KeeperHub API key.

```bash
git clone https://github.com/tommycet/recourse-chargebacks
cd recourse
forge install
forge build
forge test -vv    # 137/137 pass
```

Run the KeeperHub demo:

```bash
echo "KEEPERHUB_API_KEY=kh_your_key_here" >> .env
cd agent/src
npx tsx keeperhub-demo.ts
cat keeperhub-demo-output.json
```

Or fire up the demo UI:

```bash
cd web/
python3 -m http.server 8080
# open http://localhost:8080 — connects to Sepolia
```

The UI walks through: connect wallet, mint test USDC, create escrow, confirm or dispute, watch the arbiter resolve it, see the funds move.

---

## Reproducibility

The recorded live run in `agent/src/keeperhub-demo-output.json` has the full dispute input, verdict, execution details, and onchain verification. Check it on Blockscout: [tx `0x6ad71f82…`](https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0). Look for the `Resolved` event and the USDC transfer back to the buyer.

---

## Repo structure

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
│   ├── keeperhub-demo-output.json        — recorded live run
│   ├── arbiter-llm.ts                    — LLM + rule-based verdict engine
│   └── arbiter-runner.ts                 — dispute scenario runner
├── docs/
│   ├── evidence-bundle-spec.md           — cryptographic spec
│   ├── keeperhub-integration.md          — full integration guide
│   └── architecture.svg                  — system diagram
└── web/
    ├── index.html                        — landing page
    └── demo.html                         — live demo UI
```

---

## Roadmap

1. **x402 spec integration.** Submit an EIP-style proposal to add an optional `X-Escrow-Contract` header for drop-in adoption.
2. **Reputation oracle.** Aggregate dispute outcomes into an onchain seller reputation score.
3. **Multi-asset support.** Extend `RecourseEscrow` to any ERC-20.
4. **Decentralized arbiter network.** Staked multi-node arbitration with threshold signatures.
5. **Mainnet.** Ethereum mainnet + Optimism/Base L2s, optional insurance pool.

---

## License

MIT
