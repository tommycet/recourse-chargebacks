#!/usr/bin/env bash
set -euo pipefail

# ─── Recourse Sepolia Demo Runner ───
# Deploys if needed, then runs the escrow lifecycle demo.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_DIR/contracts"
DEMO_DIR="$PROJECT_DIR/demo"
DEPLOYED_FILE="$DEMO_DIR/deployed.json"

# Load .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  source "$PROJECT_DIR/.env"
fi

# Check required env vars
if [ -z "${SEPOLIA_RPC:-}" ]; then
  export SEPOLIA_RPC="https://ethereum-sepolia-rpc.publicnode.com"
fi
if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "ERROR: PRIVATE_KEY not set. Create .env or export PRIVATE_KEY=0x..."
  exit 1
fi

export PATH="/root/.foundry/bin:$PATH"

echo "═══════════════════════════════════════════════════"
echo "  Recourse Escrow — Sepolia Demo"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── Step 1: Build contracts ───
echo "─── Building contracts ───"
cd "$CONTRACTS_DIR"
forge build 2>&1 | grep -E "Compiler run|Error" || true

# ─── Step 2: Deploy if needed ───
NEEDS_DEPLOY=true
if [ -f "$DEPLOYED_FILE" ]; then
  DEPLOYED_ADDR=$(python3 -c "import json; print(json.load(open('$DEPLOYED_FILE'))['address'])" 2>/dev/null || echo "")
  if [ -n "$DEPLOYED_ADDR" ]; then
    echo ""
    echo "─── Already deployed at $DEPLOYED_ADDR ───"
    # Verify contract exists on chain
    CODE=$(cast code "$DEPLOYED_ADDR" --rpc-url "$SEPOLIA_RPC" 2>/dev/null || echo "0x")
    if [ "$CODE" != "0x" ] && [ -n "$CODE" ]; then
      NEEDS_DEPLOY=false
      export ESCROW_CONTRACT="$DEPLOYED_ADDR"
    else
      echo "  (Contract not found on chain — redeploying)"
    fi
  fi
fi

if [ "$NEEDS_DEPLOY" = true ]; then
  echo ""
  echo "─── Deploying RecourseEscrow to Sepolia ───"
  cd "$CONTRACTS_DIR"
  forge script script/DeployRecourseEscrow.s.sol:DeployRecourseEscrow \
    --rpc-url "$SEPOLIA_RPC" \
    --private-key "$PRIVATE_KEY" \
    --broadcast 2>&1 | tee /tmp/recourse_deploy.log

  # Extract deployed address from forge output
  DEPLOYED_ADDR=$(grep "RecourseEscrow deployed at:" /tmp/recourse_deploy.log | awk '{print $NF}' | tail -1)

  if [ -z "$DEPLOYED_ADDR" ]; then
    echo "ERROR: Could not extract deployed address. Check /tmp/recourse_deploy.log"
    exit 1
  fi

  # Save to deployed.json
  python3 -c "
import json, datetime
data = {
  'address': '$DEPLOYED_ADDR',
  'deployedAt': datetime.datetime.now().isoformat(),
  'usdc': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  'chain': 'sepolia',
  'chainId': 11155111
}
json.dump(data, open('$DEPLOYED_FILE', 'w'), indent=2)
print('Saved to $DEPLOYED_FILE')
"
  export ESCROW_CONTRACT="$DEPLOYED_ADDR"
fi

echo ""
echo "─── Contract: $ESCROW_CONTRACT ───"
echo "─── Etherscan: https://sepolia.etherscan.io/address/$ESCROW_CONTRACT ───"
echo ""

# ─── Step 3: Run demo CLI ───
MODE="${1:-happy}"
cd "$DEMO_DIR"

case "$MODE" in
  happy)
    echo "─── Running happy path: create → confirm delivery ───"
    node demo.mjs
    ;;
  dispute)
    echo "─── Running dispute path: create → dispute → arbiter refund ───"
    node demo.mjs --dispute
    ;;
  auto-refund)
    echo "─── Running auto-refund path: create → dispute ───"
    node demo.mjs --auto-refund
    ;;
  *)
    echo "Unknown mode: $MODE. Use: happy, dispute, or auto-refund"
    exit 1
    ;;
esac

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Demo complete!"
echo "  Contract: $ESCROW_CONTRACT"
echo "  Etherscan: https://sepolia.etherscan.io/address/$ESCROW_CONTRACT"
echo "═══════════════════════════════════════════════════"
