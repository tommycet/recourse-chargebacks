// agent/src/arbiter-runner.ts — Simulates a full dispute resolution flow
// Creates mock evidence bundles for different scenarios and runs the arbiter.

import { analyzeDispute, type SimpleBundle, type EscrowContext } from "./arbiter-llm.ts";

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Recourse Arbiter Runner — Dispute Simulation");
  console.log("═══════════════════════════════════════════\n");

  // Scenario 1: Seller failed to deliver (non-delivery)
  const failedBundle: SimpleBundle = {
    version: 1,
    taskId: "0x1234abcd00000000000000000000000000000000000000000000000000000001",
    buyerAddr: "0x7532A98C8eA413157787C8D2dA9659cD86D3acCe",
    sellerAddr: "0x000000000000000000000000000000000000dead",
    amount: "10000000", // 10 USDC
    requestHash: "0xabcd" + "0".repeat(58),
    responseHash: "0x0000" + "0".repeat(58), // empty response
    deliveryStatus: "failed",
    timestamp: Date.now(),
  };

  const escrow1: EscrowContext = {
    escrowId: 1,
    status: "Disputed",
    createdAt: Date.now() - 3600000,
    disputedAt: Date.now() - 600000,
  };

  console.log("Scenario 1: Non-delivery (deliveryStatus=failed)");
  console.log("  Task: ai-image-generation-service");
  console.log("  Amount: 10 USDC");
  console.log("  Running arbiter...\n");

  const verdict1 = await analyzeDispute(failedBundle, escrow1);
  console.log("  Verdict:", JSON.stringify(verdict1, null, 2));
  console.log();

  // Scenario 2: Seller delivered correctly
  const deliveredBundle: SimpleBundle = {
    version: 1,
    taskId: "0x1234abcd00000000000000000000000000000000000000000000000000000002",
    buyerAddr: "0x7532A98C8eA413157787C8D2dA9659cD86D3acCe",
    sellerAddr: "0x000000000000000000000000000000000000beef",
    amount: "5000000", // 5 USDC
    requestHash: "0xfeed" + "0".repeat(58),
    responseHash: "0xfeed" + "0".repeat(58), // matching hash = delivered
    deliveryStatus: "delivered",
    timestamp: Date.now(),
  };

  const escrow2: EscrowContext = {
    escrowId: 2,
    status: "Disputed",
    createdAt: Date.now() - 7200000,
    disputedAt: Date.now() - 300000,
  };

  console.log("Scenario 2: Delivered correctly (deliveryStatus=delivered)");
  console.log("  Task: ai-text-summarization");
  console.log("  Amount: 5 USDC");
  console.log("  Running arbiter...\n");

  const verdict2 = await analyzeDispute(deliveredBundle, escrow2);
  console.log("  Verdict:", JSON.stringify(verdict2, null, 2));
  console.log();

  // Summary
  console.log("═══════════════════════════════════════════");
  console.log("  SIMULATION SUMMARY");
  console.log("═══════════════════════════════════════════");
  console.log(`  Scenario 1 (non-delivery): buyerWins=${verdict1.buyerWins} confidence=${verdict1.confidence}`);
  console.log(`  Scenario 2 (delivered):    buyerWins=${verdict2.buyerWins} confidence=${verdict2.confidence}`);
  console.log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Arbiter runner crashed:", err);
  process.exit(1);
});
