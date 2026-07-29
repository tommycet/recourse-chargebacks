/**
 * evidenceBundle.test.ts — Unit test: build a bundle, hash it, verify it.
 *
 * Run with:
 *   /root/.hermes/node/bin/node --input-type=module < src/evidenceBundle.test.ts
 * or via ts-node/tsx if available.
 *
 * This file uses only the modules already bundled in the project (ethers v5)
 * and a simple assertion helper — no jest/mocha dependency needed.
 */

import { buildBundle, hashBundle } from "./evidenceBundle.ts";
import { verifyBundle } from "./evidenceVerifier.ts";
import { ethers } from "ethers";

/* ------------------------------------------------------------------ */
/*  Minimal assertion helper                                            */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓  ${msg}`);
    passed++;
  } else {
    console.error(`  ✗  ${msg}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  assert(actual === expected, `${msg} (got: ${actual}, expected: ${expected})`);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

console.log("\n=== evidenceBundle unit tests ===\n");

// --- Test 1: buildBundle returns correct shape ---
console.log("1. buildBundle returns correct shape");
const bundle = buildBundle({
  version: 1,
  taskId: "0x" + "ab".repeat(32),
  buyerAddr: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  sellerAddr: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  amount: BigInt("1000000"),
  requestHash: "0x" + "11".repeat(32),
  responseHash: "0x" + "22".repeat(32),
  deliveryStatus: "delivered",
  timestamp: 1700000000,
  signerPubKey: "0x" + "cc".repeat(32),
});

assertEqual(bundle.version, 1, "version");
assertEqual(bundle.deliveryStatus, "delivered", "deliveryStatus");
assertEqual(bundle.amount, BigInt("1000000"), "amount");

// --- Test 2: hashBundle returns a bytes32-length hex string ---
console.log("\n2. hashBundle returns 0x-prefixed 66-char hex");
const hash = hashBundle(bundle);
assert(typeof hash === "string", "hash is string");
assert(hash.startsWith("0x"), "hash starts with 0x");
assertEqual(hash.length, 66, "hash length is 66");

// --- Test 3: hashBundle is deterministic ---
console.log("\n3. hashBundle is deterministic");
const hash2 = hashBundle(bundle);
assertEqual(hash, hash2, "same input → same hash");

// --- Test 4: verifyBundle returns true for matching hash ---
console.log("\n4. verifyBundle returns true for matching hash");
assert(verifyBundle(bundle, hash), "verifyBundle(bundle, hash) === true");

// --- Test 5: verifyBundle returns false for wrong hash ---
console.log("\n5. verifyBundle returns false for wrong hash");
const wrongHash = "0x" + "ff".repeat(32);
assert(!verifyBundle(bundle, wrongHash), "verifyBundle(bundle, wrongHash) === false");

// --- Test 6: changing any field changes the hash ---
console.log("\n6. mutating a field changes the hash");
const bundle2 = buildBundle({ ...bundle, deliveryStatus: "failed" });
const hash3 = hashBundle(bundle2);
assert(hash !== hash3, "deliveryStatus change produces different hash");

// --- Test 7: case-insensitive comparison in verifyBundle ---
console.log("\n7. verifyBundle is case-insensitive");
assert(
  verifyBundle(bundle, hash.toUpperCase()),
  "uppercase onChainHash still matches",
);

// --- Test 8: short taskId string (formatBytes32String path) ---
console.log("\n8. short string taskId (formatBytes32String path)");
const bundleShort = buildBundle({ ...bundle, taskId: "task-42" });
const hashShort = hashBundle(bundleShort);
assert(hashShort.startsWith("0x"), "short taskId hash has 0x prefix");
assertEqual(hashShort.length, 66, "short taskId hash length 66");

// --- Test 9: address signerPubKey (40 hex chars) ---
console.log("\n9. address-format signerPubKey (40 hex chars)");
const bundleAddr = buildBundle({
  ...bundle,
  signerPubKey: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
});
const hashAddr = hashBundle(bundleAddr);
assert(hashAddr.startsWith("0x"), "address signerPubKey hash ok");

// --- Test 10: reproducible cross-bundle integrity ---
console.log("\n10. hashBundle matches manual ethers.utils.keccak256 encoding");
const { utils } = ethers;

// Re-derive expected hash manually for the first bundle
const taskId32 = bundle.taskId; // already bytes32 hex
const requestHash32 = bundle.requestHash;
const responseHash32 = bundle.responseHash;
const signerKey32 = "0x" + "cc".repeat(32);

const manualEncoded = utils.defaultAbiCoder.encode(
  ["uint8", "bytes32", "address", "address", "uint256", "bytes32", "bytes32", "uint8", "uint256", "bytes32"],
  [1, taskId32, bundle.buyerAddr, bundle.sellerAddr, bundle.amount, requestHash32, responseHash32, 0, 1700000000, signerKey32],
);
const manualHash = utils.keccak256(manualEncoded);
assertEqual(hash, manualHash, "hashBundle == manual abi.encode + keccak256");

/* ------------------------------------------------------------------ */
/*  Summary                                                             */
/* ------------------------------------------------------------------ */

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
