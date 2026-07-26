/**
 * evidence.ts — Evidence bundle primitives for the Recourse x402 wrapper.
 *
 * No external dependencies beyond Node's built-in `crypto`. Hashing uses
 * SHA3-256 (keccak-256 family). For strict Ethereum-flavoured keccak256
 * (legacy multi-rate padding), swap `keccak256Hex` to call `ethers.utils
 * .keccak256` or a `keccak` npm package when available.
 */

import { createHash } from "crypto";

/* ------------------------------------------------------------------ */
/*  Hash helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Compute the keccak-256 digest of a string or byte array, returned as a
 * 0x-prefixed hex string. Uses Node's SHA3-256 (same Keccak family, NIST
 * padding). Strict Ethereum keccak256 padding differs only in the final
 * padding byte; swap in `ethers.utils.keccak256` if a verifier requires
 * the legacy Ethereum variant.
 */
export function keccak256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return "0x" + createHash("sha3-256").update(bytes).digest("hex");
}

/** SHA-256 digest as a 0x-prefixed hex string (used for content digests). */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return "0x" + createHash("sha256").update(bytes).digest("hex");
}

/* ------------------------------------------------------------------ */
/*  Canonical JSON (deterministic key order, no whitespace)            */
/* ------------------------------------------------------------------ */

function canonicalJSON(obj: Record<string, unknown>): string {
  const seen = new WeakSet();
  const sortable = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) throw new Error("circular reference");
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(sortable);
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortable((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(sortable(obj));
}

/* ------------------------------------------------------------------ */
/*  Evidence bundle                                                     */
/* ------------------------------------------------------------------ */

export interface EvidenceBundleInput {
  requestDigest: string;
  responseDigest: string;
  contentDigest: string;
  txHash: string;
  timestamp: number;
  /** address or identifier of the signing party */
  signer: string;
  /** optional raw signature bytes (hex) produced by an external signer */
  signature?: string;
}

/**
 * JSON-serialisable evidence bundle. `JSON.stringify(bundle)` drops the
 * `hash()` and `toJSON()` methods automatically, so the object can be
 * written to disk or sent over the wire as-is.
 */
export interface EvidenceBundle {
  rulebookVersion: string;
  requestDigest: string;
  responseDigest: string;
  contentDigest: string;
  txHash: string;
  timestamp: number;
  signer: string;
  signature?: string;
  /** keccak256 of the canonical JSON serialisation (without this method). */
  hash(): string;
  /** return a plain JSON-safe object (no methods) for file writes / transport. */
  toJSON(): Record<string, unknown>;
}

/**
 * Build an evidence bundle from its constituent digests and metadata.
 * The returned object is JSON-serialisable and exposes a `hash()` method
 * that returns `keccak256(canonicalJSON(coreFields))`.
 */
export function buildBundle(input: EvidenceBundleInput): EvidenceBundle {
  const core: Record<string, unknown> = {
    rulebookVersion: "v1.0",
    requestDigest: input.requestDigest,
    responseDigest: input.responseDigest,
    contentDigest: input.contentDigest,
    txHash: input.txHash,
    timestamp: input.timestamp,
    signer: input.signer,
  };
  if (input.signature !== undefined) core.signature = input.signature;

  const hash = (): string => keccak256Hex(canonicalJSON(core));
  const toJSON = (): Record<string, unknown> => ({ ...core });

  // The bundle object IS JSON-serialisable: JSON.stringify drops the methods.
  return { ...core, hash, toJSON } as EvidenceBundle;
}

/* ------------------------------------------------------------------ */
/*  Dispute                                                             */
/* ------------------------------------------------------------------ */

export interface DisputeRecord {
  bundle: EvidenceBundle;
  bundleHash: string;
  reason: string;
  raisedAt: number;
  disputeId: string;
}

/**
 * Raise a dispute on an existing evidence bundle. Returns a `DisputeRecord`
 * containing the bundle reference, its hash, the dispute reason, a timestamp,
 * and a deterministic `disputeId` (keccak256 of the dispute metadata).
 */
export function raiseDispute(
  bundle: EvidenceBundle,
  reason: string,
): DisputeRecord {
  const raisedAt = Date.now();
  const bundleHash = bundle.hash();
  const disputeId = keccak256Hex(
    canonicalJSON({ bundleHash, reason, raisedAt }),
  );
  return {
    bundle,
    bundleHash,
    reason,
    raisedAt,
    disputeId,
  };
}

/**
 * Serialise a `DisputeRecord` to a plain JSON-safe object for file writes.
 */
export function disputeToJSON(record: DisputeRecord): Record<string, unknown> {
  return {
    disputeId: record.disputeId,
    bundleHash: record.bundleHash,
    reason: record.reason,
    raisedAt: record.raisedAt,
    bundle: record.bundle.toJSON(),
  };
}
