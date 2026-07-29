#!/bin/bash
set -euo pipefail

# Run the KeeperHub end-to-end demo
# Usage: ./scripts/run-keeperhub-demo.sh
# Requires KEEPERHUB_API_KEY in .env

cd "$(dirname "$0")/.."
source .env

if [[ -z "${KEEPERHUB_API_KEY:-}" ]]; then
  echo "ERROR: KEEPERHUB_API_KEY not set in .env"
  echo "  1. Sign up at https://app.keeperhub.com (GitHub login — no Turnstile)"
  echo "  2. Settings > API Keys > Organization > Create"
  echo "  3. Add to .env: KEEPERHUB_API_KEY=kh_..."
  exit 1
fi

echo "=== Verifying KeeperHub API key... ==="
chains=$(curl -s "https://app.keeperhub.com/api/chains" \
  -H "Authorization: Bearer $KEEPERHUB_API_KEY")
echo "$chains" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    chains = d.get('data', d) if isinstance(d, dict) else d
    if isinstance(chains, list):
        sepolia = [c for c in chains if str(c.get('chainId','')) == '11155111']
        print(f'  OK — {len(chains)} chains available')
        if sepolia:
            print(f'  Sepolia: enabled={sepolia[0].get(\"isEnabled\",\"?\")}')
    else:
        print(f'  Response: {str(d)[:200]}')
except Exception as e:
    print(f'  Parse error: {e}. Raw: {sys.stdin.read()[:300]}')
" 2>/dev/null || echo "  (could not parse chains response)"

echo ""
echo "=== Running KeeperHub dispute resolution demo... ==="
cd agent/src
npx tsx keeperhub-demo.ts

echo ""
echo "=== Output ==="
cat keeperhub-demo-output.json
