# KeeperHub Builder Feedback — Recourse Project

**Project:** Recourse — Chargebacks for the Machine Economy
**Hackathon:** KeeperHub Agents Onchain (DoraHacks)
**Date:** 2026-07-29
**GitHub:** https://github.com/tommycet/recourse-chargebacks

## Feedback Summary

We built a dispute resolution/chargeback system for agent payments using KeeperHub as the execution layer. Here's what worked, what didn't, and what we'd change.

### What Worked Well

1. **Direct Execution API** — The single HTTP call `POST /api/execute/contract-call` was the fastest way to get onchain. We went from idea to a real Sepolia tx (`0x6ad71f82...`) in under 2 hours. The payload shape (functionArgs, contractAddress, chainId, abi) is self-documenting.

2. **Smart account (EIP-7702)** — The KeeperHub wallet `0x32db...b4AF` acting as the arbiter via EIP-7702 was clean. No private key management on our side.

3. **Simulation gate** — The `simulate: true` parameter let us pre-flight the tx before broadcasting. This caught issues before we burned gas.

### Where We Got Stuck

1. **No execution status endpoint** — After creating an execution, we couldn't query its status. `GET /api/execute/{id}` returned nothing useful. We had to fall back to blockscout to find the tx hash.

2. **Webhook/MCP docs are great, but the Direct API docs are thin** — The homepage emphasizes MCP/x402, but for us the direct URL was faster to integrate. The docs for `contract-call` could cover: expected response shape, error codes, retry strategy.

3. **Region/Billing onboarding** — We didn't find a clear guide for what API key level gives what access. We used a `kh_` key but weren't sure if it had gas sponsorship or rate limits.

4. **Tx hash not returned immediately** — After execution, `txHash` was null in the response. We found it later via Etherscan internal transactions. A polling endpoint or webhook would solve this.

5. **Cloudflare Turnstile on app.keeperhub.com** — Browsere automation for signup was blocked. A headless-friendly auth path would help CI/CD.

### What We'd Like to See

1. **Execution status polling endpoint** — `GET /api/execute/{id}/status` that returns txHash after it's mined.
2. **Webhook for execution completion** — Option to register a callback URL.
3. **Starter template** — A "KeeperHub + Simple Contract / Deploy + Execute" repo with 5 steps.
4. **Better response schema docs** — Exact JSON shapes for each API response.

### Key Metric
Our single API call executed `resolveDispute(3, true, buyerAddr)` in one shot. 1 KeeperHub API call = 1 onchain tx.

## Files
- Integration code: `agent/src/keeperhub-arbiter.ts`
- Integration docs: `docs/keeperhub-integration.md`
- Demo output: `agent/src/keeperhub-demo-output.json`