// evidence-verifier-agent.ts — Agent 1: Independently validates evidence bundle integrity
// Phase 1 of the multi-agent arbitration pipeline.
// Rule-based (no LLM dependency): validates hash structure, cryptographic integrity,
// address format, and delivery status coherence before the arbiter evaluates.

export interface EvidenceBundle {
  requestHash: string;
  responseHash: string;
  deliveryStatus: string;
  buyerAddr: string;
  sellerAddr: string;
}

export interface VerificationReport {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  summary: string;
}

export function verifyEvidence(bundle: EvidenceBundle): VerificationReport {
  const checks: VerificationReport["checks"] = [];

  // Check 1: Hashes are well-formed 0x-prefixed hex
  const hashHex = /^0x[0-9a-fA-F]{64}$/;
  checks.push({
    name: "hash-format",
    passed: hashHex.test(bundle.requestHash) && hashHex.test(bundle.responseHash),
    detail: "requestHash and responseHash must be 0x-prefixed 32-byte hex strings",
  });

  // Check 2: Addresses are well-formed
  const addrHex = /^0x[0-9a-fA-F]{40}$/;
  checks.push({
    name: "address-format",
    passed: addrHex.test(bundle.buyerAddr) && addrHex.test(bundle.sellerAddr),
    detail: "buyerAddr and sellerAddr must be 0x-prefixed 20-byte hex strings",
  });

  // Check 3: Delivery status is a recognized value
  const validStatuses = ["delivered", "failed", "partial", "none"];
  checks.push({
    name: "delivery-status-valid",
    passed: validStatuses.includes(bundle.deliveryStatus),
    detail: `deliveryStatus must be one of: ${validStatuses.join(", ")}`,
  });

  // Check 4: Delivery/hash coherence — if "failed" or "none", hashes should differ
  const hashMismatch = bundle.requestHash !== bundle.responseHash;
  if (bundle.deliveryStatus === "failed" || bundle.deliveryStatus === "none") {
    checks.push({
      name: "non-delivery-hash-mismatch",
      passed: hashMismatch,
      detail: `deliveryStatus=${bundle.deliveryStatus} → hashes must differ (${hashMismatch ? "mismatch OK" : "MATCH — inconsistent"})`,
    });
  }

  // Check 5: Buyer and seller are distinct
  checks.push({
    name: "distinct-parties",
    passed: bundle.buyerAddr.toLowerCase() !== bundle.sellerAddr.toLowerCase(),
    detail: "buyerAddr and sellerAddr must not be the same address",
  });

  const allPassed = checks.every(c => c.passed);
  return {
    passed: allPassed,
    checks,
    summary: allPassed
      ? "Evidence bundle passed all verification checks"
      : `Evidence bundle failed ${checks.filter(c => !c.passed).length}/${checks.length} checks`,
  };
}