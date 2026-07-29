/**
 * evidenceVerifier.ts — Verify that a local EvidenceBundleV2 matches
 * a bytes32 hash previously stored on-chain.
 *
 * `verifyBundle(bundle, onChainHash)` recomputes the hash client-side
 * and compares it to the on-chain value (case-insensitive hex comparison).
 */

import { EvidenceBundleV2, hashBundle } from "./evidenceBundle.ts";

/**
 * Verify that the supplied bundle produces the expected on-chain hash.
 *
 * @param bundle       - The evidence bundle to verify.
 * @param onChainHash  - The bytes32 hash as stored/emitted by RecourseEscrow.
 * @returns `true` if the recomputed hash matches; `false` otherwise.
 */
export function verifyBundle(
  bundle: EvidenceBundleV2,
  onChainHash: string,
): boolean {
  const computed = hashBundle(bundle);
  return computed.toLowerCase() === onChainHash.toLowerCase();
}
