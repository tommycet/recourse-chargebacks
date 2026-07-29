// arbiter-policy-agent.ts — Agent 2: Policy enforcer that critiques the arbiter's verdict
// Phase 3 of the multi-agent arbitration pipeline.
// Rule-based (no LLM dependency): loads rulebook.json, applies policy rules,
// and decides whether to blackball (block) the arbiter's decision before KeeperHub execution.

import rulebook from "./rulebook.json";

export interface PolicyReview {
  allowed: boolean;
  blackballed: boolean;
  ruleApplied: string;
  critique: string;
  adjustments: { field: string; from: unknown; to: unknown }[];
}

export function reviewArbiterDecision(
  verdict: { buyerWins: boolean; confidence: number; reasoning: string },
  deliveryStatus: string,
): PolicyReview {
  const adjustments: PolicyReview["adjustments"] = [];
  let blackballed = false;
  let ruleApplied = rulebook.rules[0]; // default to first rule

  // Rule: buyer non-response — if deliveryStatus is "none" and buyer didn't submit evidence
  // The arbiter should still be allowed to rule, but this is a policy check
  if (deliveryStatus === "none") {
    ruleApplied = rulebook.rules[3]; // Buyer non-response rule
    // If arbiter incorrectly gives buyer a win with no evidence and no response,
    // flag as policy violation
    if (verdict.buyerWins && verdict.confidence < 0.7) {
      blackballed = true;
    }
  }

  // Rule: contentDigest mismatch — non-delivery
  if (deliveryStatus === "failed") {
    ruleApplied = rulebook.rules[1]; // ContentDigest mismatch rule
    // Arbiter should favor buyer on failed delivery
    if (!verdict.buyerWins) {
      // Policy agent overrides: clear non-delivery cases can't favor seller
      adjustments.push({
        field: "buyerWins",
        from: false,
        to: true,
      });
    }
  }

  // Rule: partial delivery → 50/50 split
  if (deliveryStatus === "partial") {
    ruleApplied = rulebook.rules[4]; // Partial delivery rule
    // Policy flag: partial always maps to neutral — confidence is inherently lower
    if (verdict.confidence > 0.8) {
      adjustments.push({
        field: "confidence",
        from: verdict.confidence,
        to: 0.5,
      });
    }
  }

  return {
    allowed: !blackballed,
    blackballed,
    ruleApplied,
    critique: blackballed
      ? `BLACKBALL: Arbiter decision violates rulebook policy (${deliveryStatus})`
      : `PASS: Arbiter decision aligns with policy "${ruleApplied}"`,
    adjustments,
  };
}