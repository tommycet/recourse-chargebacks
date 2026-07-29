// keeperhub-demo.ts — End-to-end demo: evidence bundle → AI arbiter → KeeperHub onchain execution
// Run: npx tsx keeperhub-demo.ts

import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  verifyEvidence,
  type EvidenceBundle,
} from "./evidence-verifier-agent.ts";
import {
  reviewArbiterDecision,
  type PolicyReview,
} from "./arbiter-policy-agent.ts";
import { runKeeperHubArbiter, type DisputeInput } from "./keeperhub-arbiter.ts";

function keccak256hex(data: string): string {
  return "0x" + createHash("sha256").update(data).digest("hex");
}

function randomAddress(): string {
  return "0x" + randomBytes(20).toString("hex");
}

async function demo() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Recourse + KeeperHub — Dispute Resolution Demo");
  console.log("  Executes onchain via KeeperHub (Agents Onchain hackathon)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // --- Scenario: Buyer paid for an AI image generation service ---
  // The seller received payment but delivered nothing / garbage
  const buyerAddr = process.env.DEMO_BUYER || "0x7532A98C8eA413157787C8D2dA9659cD86D3acCe";
  const sellerAddr = process.env.DEMO_SELLER || randomAddress();
  const taskId = randomBytes(32).toString("hex");

  const requestHash = keccak256hex(JSON.stringify({
    prompt: "A realistic photo of a sunset over the Pacific Ocean",
    style: "photorealistic",
    resolution: "1024x1024",
    format: "png",
  }));

  const responseHash = keccak256hex("nothing-delivered"); // seller didn't deliver

  const escrowId = parseInt(process.env.DEMO_ESCROW_ID || "1", 10);
  const amount = process.env.DEMO_AMOUNT || "10000000"; // 10 USDC (6 decimals)

  const input: DisputeInput = {
    escrowId,
    evidenceBundleHash: keccak256hex(`${requestHash}${responseHash}`),
    buyerAddr,
    sellerAddr,
    requestHash,
    responseHash,
    deliveryStatus: "failed",
    amount,
    taskId: `0x${taskId}`,
  };

  console.log("📋 Dispute Details:");
  console.log(`   Task:     AI image generation service`);
  console.log(`   Amount:   ${Number(BigInt(amount)) / 1000000} USDC`);
  console.log(`   Buyer:    ${buyerAddr}`);
  console.log(`   Seller:   ${sellerAddr}`);
  console.log(`   Status:   Seller failed to deliver`);
  console.log(`   Evidence: Request hash ${requestHash.slice(0, 18)}...`);
  console.log(`             Response hash ${responseHash.slice(0, 18)}...`);
  console.log(`             (different hashes = delivery failure)\n`);

  // Run the full pipeline: AI verdict → KeeperHub simulation → onchain execution
  const result = await runKeeperHubArbiter(input);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  FINAL RESULT");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Verdict:    ${result.verdict.buyerWins ? "✅ BUYER WINS (refund)" : "❌ SELLER WINS (payout)"} [${result.verdict.source}]`);
  console.log(`  Confidence: ${(result.verdict.confidence * 100).toFixed(0)}%`);
  console.log(`  Reasoning:  ${result.verdict.reasoning}`);
  console.log(`  TX Hash:    ${result.txHash ?? "N/A (no API key)"}`);
  console.log(`  Exec ID:    ${result.keeperHubExecutionId ?? "N/A"}`);
  console.log(`  Audit URL:  ${result.keeperHubAuditUrl ?? "N/A"}`);
  console.log(`  Status:     ${result.status}`);
  if (result.error) console.log(`  Error:      ${result.error}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Save output for submission
  const output = {
    timestamp: new Date().toISOString(),
    project: "Recourse",
    hackathon: "KeeperHub - Agents Onchain",
    contract: "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2",
    chain: "Sepolia (11155111)",
    dispute: {
      escrowId: input.escrowId,
      buyerAddr: input.buyerAddr,
      sellerAddr: input.sellerAddr,
      amount: input.amount,
      deliveryStatus: input.deliveryStatus,
      requestHash: input.requestHash,
      responseHash: input.responseHash,
    },
    verdict: result.verdict,
    execution: {
      txHash: result.txHash,
      keeperHubExecutionId: result.keeperHubExecutionId,
      keeperHubAuditUrl: result.keeperHubAuditUrl,
      status: result.status,
      error: result.error ?? null,
    },
    etherscanTxUrl: result.txHash
      ? `https://sepolia.etherscan.io/tx/${result.txHash}`
      : null,
  };

  await writeFile(
    new URL("./keeperhub-demo-output.json", import.meta.url),
    JSON.stringify(output, null, 2),
  );

  console.log("📄 Output saved to agent/src/keeperhub-demo-output.json");
  return output;
}

demo().catch((err) => {
  console.error("Demo crashed:", err);
  process.exit(1);
});
