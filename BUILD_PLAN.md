# Recourse — Hackathon-Ready Build Plan

## Current State
- Contract: `/root/recourse/contracts/src/RecourseEscrow.sol` — refactored with arbiter role, 7/7 forge tests PASS
- Contract: `/root/recourse/contracts/src/MockUSDC.sol` — mock ERC20 with mint for local testing
- Deploy script: `/root/recourse/contracts/script/DeployRecourseEscrow.s.sol` — Foundry script for Sepolia
- CLI demo: `/root/recourse/demo/demo.mjs` — viem-based, has a bug (hardcodes Sepolia USDC instead of reading contract's USDC)
- Deploy script (Node): `/root/recourse/demo/deploy.mjs` — deploys via viem, same USDC bug
- MetaMask UI: `/root/recourse/web/demo.html` — ethers.js-based, needs complete rewrite (dark-glass-clean-layout, no walletConnect, use MengTo skills)
- Shell helper: `/root/recourse/scripts/run-sepolia-demo.sh` — deploys + runs CLI
- ABI: `/root/recourse/demo/abi.json` — extracted from Foundry output

## BLOCKERS TO FIX FIRST

### 1. CLI demo.mjs USDC address bug
The CLI hardcodes `USDC_ADDR = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'` (Sepolia USDC).
But when deployed to local Anvil, the escrow contract uses MockUSDC at a different address.
**FIX**: Read USDC address from the deployed contract's `USDC()` view function instead of hardcoding.
Also fix the deploy.mjs — same issue.

### 2. The deployed.json already has the correct USDC address from deployment.
CLI should read it from deployed.json or query the contract.

## WHAT TO BUILD (in order)

### Phase 1: Fix CLI + deploy scripts (demo.mjs, deploy.mjs)
- Read USDC address from contract `USDC()` view function instead of hardcoding
- The deployed.json already has correct `usdc` field — use that
- Ensure deploy.mjs extracts bytecode correctly from Foundry artifact
- Test the full CLI flow: mint USDC → approve → createEscrow → confirmDelivery
- Test the dispute flow: mint USDC → approve → createEscrow → raiseDispute → resolveDispute

### Phase 2: Build real frontend (web/demo.html) — FULL REWRITE
Use MengTo's **dark-glass-clean-layout** skill + **operational-enterprise-ai** patterns:
- Dark glass panels, frosted shells, monochrome with burnt-sienna accent (#c84e14)
- Clean multi-column workspace layout
- MetaMask connection (inject window.ethereum)
- Three panels: Wallet status | Escrow actions | Transaction log
- Full lifecycle: Connect → Approve USDC → Create Escrow → Confirm/Raise Dispute → Resolve as Arbiter
- Display real contract state (statusOf, balances)
- Display tx hashes as clickable Etherscan links
- Include "Demo Mode" toggle that uses Anvil local (no MetaMask needed) — reads a local private key from URL hash
- Mobile responsive (stacks to single column)
- No placeholder text, no fake data, no mock responses

### Phase 3: E2E Test
- Install playwright if not installed
- Start Anvil (fork), deploy MockUSDC + RecourseEscrow
- Start HTTP server for web/demo.html
- Playwright test script:
  1. Navigate to demo.html
  2. Verify page loads (title, hero text)
  3. Click "Connect MetaMask" — in demo mode, this should work without MetaMask
  4. Fill in escrow form, submit
  5. Verify transaction log shows success
  6. Click Confirm Delivery, verify success
  7. Take screenshot of each state
- Save screenshots to /root/recourse/video/e2e_screenshots/

### Phase 4: Verify everything
- forge test still passes (7/7)
- CLI demo.mjs runs both happy and dispute paths
- Frontend loads in browser
- E2E test passes
- All files committed to git

## KEY CONSTRAINTS
- Anvil runs on localhost:8545 (Chain ID 31337)
- Account 0: 0xf39Fd6e51aad88F6F4ce6aB8827279cfFfB92266
- Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
- MockUSDC deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
- RecourseEscrow deployed at: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
- Forge: /root/.foundry/bin/forge (PATH needs export)
- Node: v22.14.0
- OpenZeppelin already installed at contracts/lib/openzeppelin-contracts
- MengTo skills installed at ~/.claude/skills/ (use dark-glass-clean-layout, operational-enterprise-ai patterns)

## HACKATHON WINNING CRITERIA
The demo must show:
1. Real smart contract on-chain (not mocked terminal output)
2. Real USDC flow: approve → escrow → delivery/dispute → arbiter resolve
3. Beautiful frontend that looks like a production product
4. Working E2E (not just compile — actually runs and displays results)
5. Professional UX: transaction status, balances, block explorer links
6. The arbiter role is key — only the arbiter can resolve disputes (permissioned)
