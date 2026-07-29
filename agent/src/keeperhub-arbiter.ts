// keeperhub-arbiter.ts — Routes dispute resolution through KeeperHub onchain execution
// KeeperHub is the execution layer: the resolveDispute() call executes VIA KeeperHub,
// satisfying the hackathon hard requirement (KeeperHub - Agents Onchain).

import { analyzeDispute, type SimpleBundle, type EscrowContext } from "./arbiter-llm.ts";

const KEEPERHUB_API = "https://app.keeperhub.com/api";
const ESCROW_ADDRESS = "0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2";
const CHAIN_ID = 11155111; // Sepolia

// resolveDispute(uint256 id, bool buyerWins, address payoutTo) — 3 params
const RESOLVE_DISPUTE_ABI = [
  {
    type: "function",
    name: "resolveDispute",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "buyerWins", type: "bool" },
      { name: "payoutTo", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

export interface DisputeInput {
  escrowId: number;
  evidenceBundleHash: string;
  buyerAddr: string;
  sellerAddr: string;
  requestHash: string;
  responseHash: string;
  deliveryStatus: "delivered" | "failed" | "partial" | "none";
  amount: string;
  taskId: string;
}

export interface ArbiterResult {
  verdict: { buyerWins: boolean; confidence: number; reasoning: string; source?: string };
  txHash: string | null;
  keeperHubExecutionId: string | null;
  keeperHubWorkflowId: string | null;
  status: "executed" | "simulated" | "no_api_key";
  keeperHubAuditUrl: string | null;
  error?: string;
}

/** Execute resolveDispute via KeeperHub Direct Execution API (single HTTP call, no workflow needed) */
async function executeViaKeeperHubDirect(
  escrowId: number,
  buyerWins: boolean,
  payoutTo: string,
  apiKey: string,
): Promise<{ txHash: string | null; executionId: string | null; error?: string }> {
  const payload = {
    contractAddress: ESCROW_ADDRESS,
    chainId: CHAIN_ID,
    functionName: "resolveDispute",
    functionArgs: JSON.stringify([escrowId, buyerWins, payoutTo]),
    abi: JSON.stringify(RESOLVE_DISPUTE_ABI),
    // omit simulate: true → actually broadcasts
  };

  const res = await fetch(`${KEEPERHUB_API}/execute/contract-call`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    return {
      txHash: null,
      executionId: null,
      error: `KeeperHub API ${res.status}: ${JSON.stringify(data)}`,
    };
  }

  const execData = (data.data ?? data) as Record<string, unknown>;
  return {
    txHash: (execData.txHash as string) ?? null,
    executionId: (execData.executionId as string) ?? (execData.id as string) ?? null,
  };
}

/** Simulate resolveDispute via KeeperHub (no gas, no broadcast — safety pre-flight) */
async function simulateViaKeeperHub(
  escrowId: number,
  buyerWins: boolean,
  payoutTo: string,
  apiKey: string,
): Promise<{ success: boolean; wouldRevert: boolean; error?: string }> {
  const payload = {
    contractAddress: ESCROW_ADDRESS,
    chainId: CHAIN_ID,
    functionName: "resolveDispute",
    functionArgs: JSON.stringify([escrowId, buyerWins, payoutTo]),
    abi: JSON.stringify(RESOLVE_DISPUTE_ABI),
    simulate: true,
  };

  const res = await fetch(`${KEEPERHUB_API}/execute/contract-call`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json() as Record<string, unknown>;
  const execData = (data.data ?? data) as Record<string, unknown>;

  return {
    success: res.ok && execData.success === true,
    wouldRevert: execData.wouldRevert === true,
    error: res.ok ? undefined : `${res.status}: ${JSON.stringify(data)}`,
  };
}

/** Main entry: run AI arbiter verdict then execute onchain via KeeperHub */
export async function runKeeperHubArbiter(input: DisputeInput): Promise<ArbiterResult> {
  const apiKey = process.env.KEEPERHUB_API_KEY;

  // 1. Run LLM arbiter (with rule-based fallback)
  const bundle: SimpleBundle = {
    version: 1,
    taskId: input.taskId,
    buyerAddr: input.buyerAddr,
    sellerAddr: input.sellerAddr,
    amount: input.amount,
    requestHash: input.requestHash,
    responseHash: input.responseHash,
    deliveryStatus: input.deliveryStatus,
    timestamp: Date.now(),
  };

  const escrowCtx: EscrowContext = {
    escrowId: input.escrowId,
    status: "Disputed",
    createdAt: Date.now() - 3600000,
    disputedAt: Date.now() - 600000,
  };

  console.log(`[arbiter] Running LLM analysis for escrow #${input.escrowId}...`);
  const verdict = await analyzeDispute(bundle, escrowCtx);
  console.log(`[arbiter] Verdict: buyerWins=${verdict.buyerWins} confidence=${verdict.confidence}`);
  console.log(`[arbiter] Reasoning: ${verdict.reasoning}`);

  // Payout goes to winning party
  const payoutTo = verdict.buyerWins ? input.buyerAddr : input.sellerAddr;

  if (!apiKey) {
    console.log("[keeperhub] No KEEPERHUB_API_KEY — skipping onchain execution");
    return {
      verdict,
      txHash: null,
      keeperHubExecutionId: null,
      keeperHubWorkflowId: null,
      status: "no_api_key",
      keeperHubAuditUrl: null,
      error: "KEEPERHUB_API_KEY not set — set it in .env to enable onchain execution",
    };
  }

  // 2. Simulate first (safety gate)
  console.log(`[keeperhub] Simulating resolveDispute(${input.escrowId}, ${verdict.buyerWins}, ${payoutTo})...`);
  const sim = await simulateViaKeeperHub(input.escrowId, verdict.buyerWins, payoutTo, apiKey);

  if (!sim.success || sim.wouldRevert) {
    console.log(`[keeperhub] Simulation rejected: wouldRevert=${sim.wouldRevert} error=${sim.error ?? "none"}`);
    return {
      verdict,
      txHash: null,
      keeperHubExecutionId: null,
      keeperHubWorkflowId: null,
      status: "simulated",
      keeperHubAuditUrl: null,
      error: `Simulation failed: ${sim.error ?? "would revert"}`,
    };
  }

  console.log("[keeperhub] Simulation passed — broadcasting transaction...");

  // 3. Execute via KeeperHub
  const exec = await executeViaKeeperHubDirect(input.escrowId, verdict.buyerWins, payoutTo, apiKey);

  if (exec.error) {
    console.log(`[keeperhub] Execution failed: ${exec.error}`);
    return {
      verdict,
      txHash: null,
      keeperHubExecutionId: null,
      keeperHubWorkflowId: null,
      status: "simulated",
      keeperHubAuditUrl: null,
      error: exec.error,
    };
  }

  const auditUrl = exec.executionId
    ? `https://app.keeperhub.com/runs/${exec.executionId}`
    : null;

  console.log(`[keeperhub] ✅ Transaction executed!`);
  console.log(`[keeperhub]    tx hash:      ${exec.txHash}`);
  console.log(`[keeperhub]    execution ID: ${exec.executionId}`);
  console.log(`[keeperhub]    audit trail:  ${auditUrl}`);

  return {
    verdict,
    txHash: exec.txHash,
    keeperHubExecutionId: exec.executionId,
    keeperHubWorkflowId: null,
    status: "executed",
    keeperHubAuditUrl: auditUrl,
  };
}
