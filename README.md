# Recourse — Chargebacks for the Machine Economy

> **The first dispute-resolution protocol for autonomous AI agents transacting over x402.**

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)](https://soliditylang.org)
[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-orange)](https://book.getfoundry.sh)
[![Network](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io)
[![Execution](https://img.shields.io/badge/Execution-KeeperHub-blueviolet)](https://docs.keeperhub.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## The Problem

### x402 Has No Safety Net

The HTTP 402 payment protocol unlocked a new paradigm: machines paying machines, at internet scale, without human approval flows. Agents can now purchase API access, compute time, data feeds, and services autonomously — and they do. The protocol has seen rapid adoption across AI agent payment flows.

But there is a critical flaw baked into the spec.

From [x402 Protocol Specification v2, §2 Core Payment Flow](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md):

The x402 specification defines a 4-step payment flow: request → payment required → payment authorization → settlement. Nowhere in the spec is there a dispute, delivery verification, or chargeback mechanism. Once `/settle` broadcasts the blockchain transfer, the payment is final — even if the seller delivered nothing.

The x402 specification defines a payment flow that goes from payment authorization to blockchain settlement — with no dispute, delivery verification, or chargeback mechanism. A seller can receive payment and provide degraded or zero service, and the buyer has no recourse.

### The Pattern Is Old. The Solution Already Exists — For Humans.

In **1974**, the United States passed the **Fair Credit Billing Act**. It mandated that card networks provide consumers with a formal dispute process: submit a claim, present evidence, receive a binding decision. Visa, Mastercard, and Amex built chargeback rails on top of this law. Today, those rails process ~600 million disputes per year with a median resolution time of 30 days.

The agent economy in 2025 has payments. It does not have a dispute system.

When an AI agent's task fails — a purchased API returns garbage, a compute job delivers corrupted output, a data provider sends stale feeds — the agent has no recourse. The funds are gone. The transaction is final. There is no 1-800 number to call, no chargeback form to file, no arbiter to escalate to.

**Recourse is the Fair Credit Billing Act for the machine economy.**

---

## Solution

Recourse introduces three primitives that together close the accountability gap:

1. **Escrow-first settlement** — funds are locked in a smart contract at payment time, not released until delivery is verified or a dispute window closes.
2. **Cryptographic evidence bundles** — both the request and response are hashed and committed on-chain at transaction time, creating a tamper-proof audit trail that can be produced in any dispute.
3. **AI arbiter at machine speed** — disputes are resolved by a neutral AI arbiter that evaluates evidence bundles against the service contract, issues a binding on-chain verdict, and releases or refunds funds — all within seconds, not weeks.

No humans in the loop. No 30-day wait. No $25 chargeback fee. Just verifiable fairness at the speed the machine economy actually operates.

---

## How It Works

**1. Agent initiates payment**
The buyer agent sends a standard x402 payment request. Instead of transferring directly to the seller, funds are deposited into `RecourseEscrow` — a Solidity contract that holds the payment pending delivery confirmation.

**2. Seller delivers (or doesn't)**
The seller service fulfills the request and submits a cryptographic evidence bundle: a signed, hashed record of the request received, the response delivered, and a delivery status attestation. This bundle is stored as a `bytes32` commitment on-chain.

**3. Buyer verifies**
The buyer agent inspects the response. If delivery is confirmed, it calls `confirmDelivery()` and funds release to the seller immediately. If the buyer disputes within the challenge window, it calls `openDispute()` and submits its own evidence bundle.

**4. Arbiter resolves**
The AI arbiter evaluates both evidence bundles off-chain, reconstructs and verifies the on-chain hashes, scores delivery quality against the original service spec, and submits a signed verdict. The contract releases funds to the winning party. The entire process takes under 60 seconds.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     RECOURSE PROTOCOL FLOW                      │
└─────────────────────────────────────────────────────────────────┘

  ┌───────────┐   x402 payment   ┌──────────────────┐
  │           │ ────────────────► │                  │
  │   Buyer   │                  │  RecourseEscrow  │
  │   Agent   │ ◄──────────────── │  (Solidity)      │
  │           │  confirm/dispute  │                  │
  └─────┬─────┘                  └────────┬─────────┘
        │                                 │
        │  request                        │  escrow lock
        ▼                                 ▼
  ┌───────────┐   evidence bundle  ┌──────────────────┐
  │           │ ────────────────── │                  │
  │  Seller   │                   │   Evidence Store  │
  │  Service  │                   │  (on-chain hash)  │
  │           │                   │                   │
  └───────────┘                   └────────┬──────────┘
                                           │
                                  dispute? │
                                           ▼
                                  ┌────────────────┐
                                  │                │
                                  │  AI Arbiter    │
                                  │  (off-chain +  │
                                  │   on-chain     │
                                  │   verdict sig) │
                                  │                │
                                  └───────┬────────┘
                                          │
                               ┌──────────▼──────────┐
                               │                     │
                               │     Resolution      │
                               │                     │
                               │  ✓ Release to seller│
                               │  ✗ Refund to buyer  │
                               │                     │
                               └─────────────────────┘


  Agent ──► x402 ──► RecourseEscrow ──► Arbiter ──► Resolution
```

### Component Breakdown

| Component | Role | Tech |
|-----------|------|------|
| `RecourseEscrow.sol` | Holds funds, manages dispute lifecycle | Solidity 0.8.20 |
| `MockUSDC.sol` | ERC-20 test token for Sepolia demos | Solidity 0.8.20 |
| Evidence Bundle | Signed hash of request/response pair | keccak256 + ABI encoding |
| AI Arbiter | Evaluates disputes, submits verdicts | TypeScript + LLM |
| **KeeperHub** | **Onchain execution layer for dispute resolution** | **KeeperHub Direct Execution API** |
| Demo UI | Browser interface for testing flows | HTML/CSS/JS + ethers.js |
| E2E Tests | Automated buyer/seller/dispute flows | Playwright |

---

## Live Contracts (Sepolia)

Both contracts are deployed and verified on Ethereum Sepolia testnet.

| Contract | Address | Etherscan |
|----------|---------|-----------|
| **RecourseEscrow** | `0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2) |
| **MockUSDC** | `0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA) |

To interact directly:

```bash
# Read escrow state for a task
cast call 0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2 \
  "getEscrow(bytes32)(address,address,uint256,uint8)" \
  <taskId> \
  --rpc-url https://rpc.sepolia.org

# Check MockUSDC balance
cast call 0xe1d9BE71FeCeBF32424227475d389A3e8BAF01EA \
  "balanceOf(address)(uint256)" \
  <your-address> \
  --rpc-url https://rpc.sepolia.org
```

---

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)
- Node.js 18+ (for the demo UI and arbiter)
- A Sepolia RPC URL and funded wallet (for live deployment)

### Build and Test

```bash
# Clone the repo
git clone https://github.com/your-org/recourse
cd recourse

# Install Foundry dependencies
forge install

# Compile contracts
forge build

# Run the full test suite
forge test -vv
```

### Run the Demo UI

```bash
# Serve the web interface locally
cd web/
python3 -m http.server 8080
# or
npx serve .

# Open http://localhost:8080
```

The demo UI walks through a complete escrow lifecycle:
1. Connect wallet (MetaMask, Sepolia network)
2. Mint test USDC from the MockUSDC faucet
3. Create an escrow for a mock task
4. Simulate delivery confirmation or dispute
5. Watch the arbiter resolve and funds move

### Run E2E Tests

```bash
# Install Playwright
npm install
npx playwright install

# Start local anvil fork
anvil --fork-url https://rpc.sepolia.org &

# Run end-to-end tests
npx playwright test
```

### Deploy to Your Own Testnet

```bash
# Copy env template
cp .env.example .env
# Fill in PRIVATE_KEY and RPC_URL

# Deploy contracts
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
```

---

## KeeperHub Integration

Recourse uses [KeeperHub](https://docs.keeperhub.com) as its onchain execution layer. The AI arbiter's dispute resolution verdict triggers a KeeperHub workflow that executes `resolveDispute()` on Sepolia — KeeperHub handles gas estimation, retry logic, and produces a full audit trail.

| Stage | KeeperHub surface |
|-------|-------------------|
| Verdict delivery | `POST /api/execute/contract-call` — Direct Execution API |
| State verification | `web3/read-contract` — reads escrow status |
| Onchain resolution | `web3/write-contract` — calls `resolveDispute(id, buyerWins, payoutTo)` |
| Observability | KeeperHub audit trail — trigger, simulation, tx hash, gas used, outcome |

### Quick Run

```bash
# Set your KeeperHub API key
echo "KEEPERHUB_API_KEY=kh_your_key_here" >> .env

# Run the full demo: arbiter → KeeperHub simulation → onchain execution
cd agent/src
npx tsx keeperhub-demo.ts

# Check the output
cat keeperhub-demo-output.json
```

See [docs/keeperhub-integration.md](docs/keeperhub-integration.md) for the full integration guide.

---

## Roadmap

1. **x402 spec integration** — Submit an EIP-style proposal to the x402 working group to add an optional `X-Escrow-Contract` header that signals Recourse-compatible payment, enabling drop-in adoption without breaking existing clients.

2. **Reputation oracle** — Aggregate dispute outcomes into an on-chain reputation score for sellers. Buyers can query a seller's dispute rate before transacting, creating market incentives for honest service delivery.

3. **Multi-asset support** — Extend `RecourseEscrow` to handle any ERC-20 token (USDC, USDT, DAI, WETH), not just MockUSDC, enabling the protocol to work across the full DeFi payment stack.

4. **Decentralized arbiter network** — Replace the single AI arbiter with a staked arbiter network where multiple nodes independently evaluate disputes, and a threshold signature releases the verdict — eliminating single points of failure and capture.

5. **Mainnet deployment + insurance pool** — Deploy on Ethereum mainnet and Optimism/Base L2s, with an optional insurance pool that buyers can pay into for instant guaranteed refunds on disputes under a threshold amount, funded by a small protocol fee.

---

## Why This Matters Now

The x402 protocol is being adopted faster than the infrastructure around it can mature. Every week, more autonomous agents are authorized to spend real money on behalf of real users and businesses. Every week, the attack surface described in the x402 settlement flow grows.

Recourse is not a theoretical fix. It is a deployed, working system that proves the safety model is possible without changing the x402 spec, without slowing down payments, and without requiring human intervention.

**The machine economy needs chargebacks. We built them.**

---

## Contributing

PRs welcome. Open an issue before large changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT © 2025 Recourse Contributors
