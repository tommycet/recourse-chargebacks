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

### Issues We'd File (For Onboarding Bounty)

Based on our integration experience, here are the specific reproducible issues we'd file against the KeeperHub repo:

1. **[Bug] `txHash` is null in Direct Execution API response** — After `POST /api/execute/contract-call` succeeds, `txHash` is null. Must poll Etherscan or Blockscout to find the actual tx hash. Suggest returning txHash in the response once broadcast, or providing a `GET /api/execute/{id}/status` endpoint.

2. **[Docs] Direct Execution API response schema undocumented** — The docs show the request payload but not the response JSON shape. We had to trial-and-error to discover fields like `executionId`, `simulate`, and the null txHash behavior.

3. **[Docs] No retry strategy guidance** — The API returns 429s under load. No docs on whether retries are safe, what idempotency key to use, or what backoff schedule to follow. We implemented exponential backoff (2s/4s/8s) but guidance would help.

4. **[Feature] Execution status polling endpoint** — `GET /api/execute/{executionId}` should return: status (pending/broadcast/confirmed/failed), txHash, blockNumber, gasUsed. Currently returns minimal info.

5. **[Onboarding] Zero-to-first-tx starter template** — No official "hello world" repo. Our `docs/keeperhub-integration.md` covers the 5-step flow but a cloneable repo would reduce time-to-first-tx from 2h to 15min.

### Files
- Integration code: `agent/src/keeperhub-arbiter.ts`
- MCP integration: `agent/src/keeperhub-mcp.ts`
- Integration docs: `docs/keeperhub-integration.md`
- Builder feedback: `docs/keeperhub-builder-feedback.md`
- Demo output: `agent/src/keeperhub-demo-output.json`