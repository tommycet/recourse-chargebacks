/**
 * evidenceBundle.ts — Ethereum-compatible evidence bundle for the Recourse escrow.
 *
 * `buildBundle()` constructs a typed bundle matching the on-chain struct shape.
 * `hashBundle()` produces a bytes32-compatible keccak256 that Solidity would
 * compute with abi.encode(...) on the same fields — suitable for the
 * `evidenceBundleHash` param of RecourseEscrow.createEscrow().
 *
 * DeliveryStatus enum values mirror a hypothetical Solidity enum:
 *   0 = delivered, 1 = failed, 2 = partial
 */

import { ethers } from "ethers";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type DeliveryStatus = "delivered" | "failed" | "partial";

/** Numeric encoding for DeliveryStatus (uint8 on-chain). */
const DELIVERY_STATUS_CODE: Record<DeliveryStatus, number> = {
  delivered: 0,
  failed: 1,
  partial: 2,
};

export interface EvidenceBundleV2 {
  version: number;
  taskId: string;
  buyerAddr: string;
  sellerAddr: string;
  amount: bigint;
  requestHash: string;
  responseHash: string;
  deliveryStatus: DeliveryStatus;
  timestamp: number;
  signerPubKey: string;
}

/* ------------------------------------------------------------------ */
/*  ABI encoding types (must match Solidity abi.encode order/types)    */
/* ------------------------------------------------------------------ */

const ABI_TYPES = [
  "uint8",    // version
  "bytes32",  // taskId
  "address",  // buyerAddr
  "address",  // sellerAddr
  "uint256",  // amount
  "bytes32",  // requestHash
  "bytes32",  // responseHash
  "uint8",    // deliveryStatus
  "uint256",  // timestamp
  "bytes32",  // signerPubKey (first 32 bytes of pubkey, or keccak256 of full pubkey)
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Coerce a string to bytes32.
 * - If it's already a 0x-prefixed 66-char hex string, use as-is.
 * - If it looks like a plain ASCII task identifier, encode via formatBytes32String.
 * - Otherwise, keccak256 it to produce a deterministic bytes32.
 */
function toBytes32(value: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value;
  if (value.length <= 31) {
    // fits in bytes32 as left-padded ASCII (matches Solidity string<32 literals)
    try {
      return ethers.utils.formatBytes32String(value);
    } catch (_) {
      // fall through
    }
  }
  // Hash it — deterministic, Solidity-compatible
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(value));
}

/**
 * Coerce a signerPubKey (hex pubkey or address) to bytes32.
 * - 64-byte uncompressed pubkey (0x04... or raw 128 hex chars): take last 32 bytes.
 * - 20-byte address (40 hex chars): zero-pad left to bytes32.
 * - bytes32 hex: pass through.
 */
function signerPubKeyToBytes32(pubKey: string): string {
  const hex = pubKey.startsWith("0x") ? pubKey.slice(2) : pubKey;
  if (hex.length === 128 || hex.length === 130) {
    // uncompressed 64-byte pubkey (optionally 04-prefixed) — take last 32 bytes
    return "0x" + hex.slice(-64);
  }
  if (hex.length === 64) return "0x" + hex;
  if (hex.length === 40) {
    // Ethereum address — pad to bytes32
    return "0x" + "0".repeat(24) + hex;
  }
  // fallback: keccak256
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(pubKey));
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build a typed evidence bundle. Normalises field types for safe hashing.
 * Returns a new bundle object (immutable input is preserved).
 */
export function buildBundle(input: EvidenceBundleV2): EvidenceBundleV2 {
  return {
    version: input.version,
    taskId: input.taskId,
    buyerAddr: input.buyerAddr,
    sellerAddr: input.sellerAddr,
    amount: input.amount,
    requestHash: input.requestHash,
    responseHash: input.responseHash,
    deliveryStatus: input.deliveryStatus,
    timestamp: input.timestamp,
    signerPubKey: input.signerPubKey,
  };
}

/**
 * Compute the on-chain-compatible keccak256 of the evidence bundle.
 *
 * Encoding matches:
 *   keccak256(abi.encode(
 *     uint8(version), bytes32(taskId), address(buyerAddr), address(sellerAddr),
 *     uint256(amount), bytes32(requestHash), bytes32(responseHash),
 *     uint8(deliveryStatus), uint256(timestamp), bytes32(signerPubKey)
 *   ))
 *
 * Returns a 0x-prefixed 66-char hex bytes32 hash.
 */
export function hashBundle(bundle: EvidenceBundleV2): string {
  const values = [
    bundle.version,                                           // uint8
    toBytes32(bundle.taskId),                                 // bytes32
    bundle.buyerAddr,                                         // address
    bundle.sellerAddr,                                        // address
    bundle.amount,                                            // uint256
    toBytes32(bundle.requestHash),                            // bytes32
    toBytes32(bundle.responseHash),                           // bytes32
    DELIVERY_STATUS_CODE[bundle.deliveryStatus],              // uint8
    bundle.timestamp,                                         // uint256
    signerPubKeyToBytes32(bundle.signerPubKey),               // bytes32
  ];

  const encoded = ethers.utils.defaultAbiCoder.encode(ABI_TYPES, values);
  return ethers.utils.keccak256(encoded);
}
