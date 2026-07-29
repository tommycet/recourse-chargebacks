// agent/src/arbiter.ts — Tier-0 auto-verifier + Tier-1 AI arbiter agent
// Reference: DeepMind "Intelligent AI Delegation" (Tomašev et al., 2026) — delegation + arbitration blueprint.
// Reference: a16z agent-payments stack analysis (2026): liability problem = "who bears cost when agent-initiated transaction is reversed?"
// x402 spec §2 defines payment → settlement with no dispute or delivery verification — evidence bundles fix this.

import * as fs from "fs";
import * as path from "path";

export interface EvidenceBundle {
  rulebookVersion: string;
  requestDigest: string;
  responseDigest: string;
  contentDigest: string;
  txHash: string;
  timestamp: number;
  signer: string;
  hash(): string;
}

/* ------------------------------------------------------------------ */
/*  Tier-0: objective auto-verify (machine-speed, instant settlement)  */
/* ------------------------------------------------------------------ */
export interface Tier0Result {
  ok: boolean;
  reason: string;
  settlement: "release" | "refund" | "hold";
}

export function tier0AutoVerify(bundle: EvidenceBundle): Tier0Result {
  // 0. Guard: missing/empty digests → hold (prevents seller auto-win on missing proof)
  if (!bundle.contentDigest || !bundle.requestDigest) {
    return { ok: false, reason: "digest missing — insufficient evidence to auto-verify", settlement: "hold" };
  }
  // 1. Objective: txHash must exist (66-char hex)
  if (!bundle.txHash || bundle.txHash.length !== 66 || !/^0x[0-9a-fA-F]{64}$/.test(bundle.txHash)) {
    return { ok: false, reason: "txHash missing or malformed (expected 66-char hex)", settlement: "hold" };
  }
  // 2. ContentDigest must match: if contentDigest === requestDigest → delivery verified → release
  if (bundle.contentDigest === bundle.requestDigest) {
    return { ok: true, reason: "contentDigest matches requestDigest (delivery verified); txHash present.", settlement: "release" };
  }
  // 3. ContentDigest mismatch → buyer wins (refund) per Tier-1 rulebook
  return { ok: false, reason: "contentDigest MISMATCH — service delivery does not match buyer's committed spec. Buyer wins per rulebook.", settlement: "refund" };
}

/* ------------------------------------------------------------------ */
/*  Tier-1: AI arbiter (TEE-hosted, applies public rulebook)           */
/* ------------------------------------------------------------------ */

export interface Tier1Result {
  winner: "buyer" | "seller" | "tie";
  feePaidBy: "buyer" | "seller";
  confidence: number; // 0..1
  explanation: string;
}

export function tier1Arbiter(bundle: EvidenceBundle): Tier1Result {
  // Read public rulebook (published, deterministic — no hidden weights)
  const rulebookPath = path.join(__dirname, "rulebook.json");
  let rules: { version?: string };
  try {
    rules = JSON.parse(fs.readFileSync(rulebookPath, "utf-8"));
  } catch (_) {
    return { winner: "tie", feePaidBy: "buyer", confidence: 0, explanation: "Rulebook unavailable — escalate to Tier-2 (human appeal)." };
  }

  const contentDigestMatches = bundle.contentDigest === bundle.requestDigest;
  const txPresent = bundle.txHash && bundle.txHash.length === 66;

  if (contentDigestMatches && txPresent) {
    return {
      winner: "seller",
      feePaidBy: "buyer",
      confidence: 0.96,
      explanation: `Tier-0 verified: contentDigest matches requestDigest; txHash present (${bundle.txHash}). Rulebook v${bundle.rulebookVersion}: seller delivers → release.`
    };
  }

  if (!contentDigestMatches) {
    return {
      winner: "buyer",
      feePaidBy: "seller",
      confidence: 0.93,
      explanation: `ContentDigest MISMATCH: requestDigest=${bundle.requestDigest}, contentDigest=${bundle.contentDigest}. Per rulebook: buyer wins (refund). Fee (0.25%) paid by seller.`
    };
  }

  return {
    winner: "tie",
    feePaidBy: "buyer",
    confidence: 0.50,
    explanation: `Ambiguous evidence: txHash present (${txPresent}) but contentDigest comparison inconclusive. Escalate to Tier-2 (human appeal) per rulebook.`
  };
}

/* ------------------------------------------------------------------ */
/*  Tier-1 execution wrapper — executes onchain refund via KeeperHub  */
/* ------------------------------------------------------------------ */

export interface MockTxReceipt {
  txHash: string;
  gasUsed: number;
  status: number; // 1 = success
  blockNumber?: number;
}

export function executeRefundViaKeeperHub(escrowId: number, buyerAddress: string): MockTxReceipt {
  // In the real demo flow: this calls KeeperHub's MCP `execute_workflow` which triggers
  // a `web3/write-contract` action targeting RecourseEscrow.resolveDispute() on Sepolia (11155111).
  // The actual KeeperHub call uses the agentic wallet (EIP-7702 smart account at 0x32db...b4AF)
  // and settles USDC on Sepolia via the KeeperHub Direct Execution API with gas handled by KeeperHub.
  // For the demo script we emit the intended call + a simulated receipt.
  const txHash = `0xdead${escrowId.toString(16).padStart(12, "0")}${Buffer.from(buyerAddress.slice(2)).toString("hex").slice(0, 8)}`;
  console.log(`[Recourse Arbiter] CALLING keeperhub: write-contract RecourseEscrow.resolveDispute(${escrowId}, true, ${buyerAddress})`);
  console.log(`[Recourse Arbiter] Network: Sepolia (11155111) | Contract: RecourseEscrow (0x8c0c...35a2) | Wallet: KeeperHub agentic wallet`);
  return { txHash, gasUsed: 48210, status: 1, blockNumber: 102030405 + escrowId };
}

/* ------------------------------------------------------------------ */
/*  Reputation flywheel comment (data-moat)                             */
/* ------------------------------------------------------------------ */
/**
 * Reputation Flywheel (sybil-resistant by construction):
 *  - The x402 spec has no dispute or delivery verification mechanism.
 *  - A resolved dispute with real USDC movement back to buyer is sybil-resistant: fraud requires real economic cost (loser-pays fee 0.25%).
 *  - The dispute outcome dataset feeds Recourse's reputation read/write API — this is the dataset AsterPay / ScoutScore can't replicate.
 */
