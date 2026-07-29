# Evidence Bundle Specification

**Version:** 1.0  
**Status:** Canonical  
**Used by:** `RecourseEscrow.sol` — dispute evaluation and arbiter verdict verification

---

## Overview

An **evidence bundle** is a signed, serialized record of a single x402 transaction. It captures the request made by a buyer agent, the response delivered by a seller service, and a delivery status attestation — then hashes all fields into a single `bytes32` commitment that is stored on-chain when an escrow is created or a dispute is opened.

During dispute resolution, the AI arbiter reconstructs this hash from the raw bundle fields to verify authenticity before evaluating delivery quality.

---

## Fields

| Field | Solidity Type | Description |
|-------|--------------|-------------|
| `version` | `uint8` | Bundle schema version. Current value: `1`. Increment on breaking changes. |
| `taskId` | `bytes32` | Unique identifier for the task/transaction. Matches the `taskId` in `RecourseEscrow`. Typically `keccak256(abi.encode(buyerAddr, sellerAddr, nonce, block.timestamp))`. |
| `buyerAddr` | `address` | Ethereum address of the buyer agent who initiated payment. |
| `sellerAddr` | `address` | Ethereum address of the seller service that received escrow. |
| `amount` | `uint256` | Payment amount in the escrow token's smallest unit (e.g., USDC with 6 decimals: 1 USDC = `1000000`). |
| `requestHash` | `bytes32` | `keccak256` hash of the full HTTP request body sent by the buyer agent (headers + payload). |
| `responseHash` | `bytes32` | `keccak256` hash of the full HTTP response body returned by the seller service. |
| `deliveryStatus` | `string` (enum) | UTF-8 string, one of: `"DELIVERED"`, `"PARTIAL"`, `"FAILED"`, `"TIMEOUT"`. Attested by the seller at response time. |
| `timestamp` | `uint256` | Unix timestamp (seconds) when the seller committed the evidence. Must be within the escrow's challenge window. |
| `signerPubKey` | `bytes` | Uncompressed 65-byte secp256k1 public key of the evidence signer (seller). Used to verify the bundle signature off-chain. |

### `deliveryStatus` Enum Values

| Value | Meaning |
|-------|---------|
| `"DELIVERED"` | Seller attests full, correct delivery of the requested service. |
| `"PARTIAL"` | Seller attests partial delivery (e.g., degraded quality, incomplete response). |
| `"FAILED"` | Seller acknowledges the service could not be delivered. |
| `"TIMEOUT"` | Response was not returned within the agreed SLA window. |

---

## Hash Algorithm

The canonical bundle hash is computed using Solidity ABI encoding and keccak256:

```solidity
bytes32 bundleHash = keccak256(
    abi.encode(
        version,          // uint8
        taskId,           // bytes32
        buyerAddr,        // address
        sellerAddr,       // address
        amount,           // uint256
        requestHash,      // bytes32
        responseHash,     // bytes32
        keccak256(bytes(deliveryStatus)),   // bytes32 (hash of UTF-8 string)
        timestamp,        // uint256
        keccak256(signerPubKey)             // bytes32 (hash of raw pubkey bytes)
    )
);
```

**Why hash `deliveryStatus` and `signerPubKey` before encoding?**  
`abi.encode` handles dynamic-length types (`bytes`, `string`) by including a length prefix and padding to 32-byte words. Hashing them first normalizes them to `bytes32` values, making the encoding deterministic and gas-efficient, and matching the behavior expected by `abi.encode` for fixed-size types.

---

## Example JSON Bundle

The off-chain representation of a bundle is a JSON object. The `bundleHash` field is included for reference but is not part of the signed payload — it is derived from the other fields.

```json
{
  "version": 1,
  "taskId": "0x3b5f2a1e4c8d9f0a7b6e5d4c3a2b1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4",
  "buyerAddr": "0xAbCd1234567890EF1234567890abcdef12345678",
  "sellerAddr": "0x9876543210FEdCBA9876543210fedcba98765432",
  "amount": "5000000",
  "requestHash": "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  "responseHash": "0xb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
  "deliveryStatus": "DELIVERED",
  "timestamp": 1722211200,
  "signerPubKey": "0x04a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
  "signature": "0x...",
  "bundleHash": "0xdeadbeefcafebabe000000000000000000000000000000000000000000000000"
}
```

**Field notes:**
- `amount`: `5000000` = 5 USDC (6 decimal places)
- `signerPubKey`: 65 bytes, `0x04` prefix indicates uncompressed secp256k1 point
- `signature`: ECDSA signature over `bundleHash` using the seller's private key
- `bundleHash`: Derived field — compute with the algorithm above, do not trust from untrusted sources

---

## Verification

### On-Chain (Solidity)

```solidity
// RecourseEscrow.sol — submitEvidence()
function verifyBundle(
    uint8 version,
    bytes32 taskId,
    address buyerAddr,
    address sellerAddr,
    uint256 amount,
    bytes32 requestHash,
    bytes32 responseHash,
    string calldata deliveryStatus,
    uint256 timestamp,
    bytes calldata signerPubKey
) public pure returns (bytes32) {
    return keccak256(
        abi.encode(
            version,
            taskId,
            buyerAddr,
            sellerAddr,
            amount,
            requestHash,
            responseHash,
            keccak256(bytes(deliveryStatus)),
            timestamp,
            keccak256(signerPubKey)
        )
    );
}

// To verify the submitted hash matches the stored commitment:
// require(computedHash == storedCommitment, "Evidence bundle hash mismatch");
```

### Off-Chain (TypeScript / ethers.js)

```typescript
import { ethers } from "ethers";

interface EvidenceBundle {
  version: number;
  taskId: string;         // bytes32 hex
  buyerAddr: string;      // address
  sellerAddr: string;     // address
  amount: bigint;
  requestHash: string;    // bytes32 hex
  responseHash: string;   // bytes32 hex
  deliveryStatus: string;
  timestamp: number;
  signerPubKey: Uint8Array;
}

function computeBundleHash(bundle: EvidenceBundle): string {
  const deliveryStatusHash = ethers.keccak256(
    ethers.toUtf8Bytes(bundle.deliveryStatus)
  );
  const signerPubKeyHash = ethers.keccak256(bundle.signerPubKey);

  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "uint8",    // version
      "bytes32",  // taskId
      "address",  // buyerAddr
      "address",  // sellerAddr
      "uint256",  // amount
      "bytes32",  // requestHash
      "bytes32",  // responseHash
      "bytes32",  // keccak256(deliveryStatus)
      "uint256",  // timestamp
      "bytes32",  // keccak256(signerPubKey)
    ],
    [
      bundle.version,
      bundle.taskId,
      bundle.buyerAddr,
      bundle.sellerAddr,
      bundle.amount,
      bundle.requestHash,
      bundle.responseHash,
      deliveryStatusHash,
      bundle.timestamp,
      signerPubKeyHash,
    ]
  );

  return ethers.keccak256(encoded);
}

// Usage:
const hash = computeBundleHash(bundle);
// Compare against the on-chain stored commitment:
// const storedHash = await escrowContract.getEvidenceHash(taskId);
// assert(hash === storedHash, "Bundle hash mismatch — evidence may be tampered");
```

### Off-Chain (Python / web3.py)

```python
from eth_abi import encode
from eth_utils import keccak

def compute_bundle_hash(bundle: dict) -> bytes:
    delivery_status_hash = keccak(text=bundle["deliveryStatus"])
    signer_pub_key_hash = keccak(primitive=bundle["signerPubKey"])

    encoded = encode(
        ["uint8", "bytes32", "address", "address", "uint256",
         "bytes32", "bytes32", "bytes32", "uint256", "bytes32"],
        [
            bundle["version"],
            bytes.fromhex(bundle["taskId"][2:]),
            bundle["buyerAddr"],
            bundle["sellerAddr"],
            bundle["amount"],
            bytes.fromhex(bundle["requestHash"][2:]),
            bytes.fromhex(bundle["responseHash"][2:]),
            delivery_status_hash,
            bundle["timestamp"],
            signer_pub_key_hash,
        ]
    )

    return keccak(encoded)
```

---

## Security Notes

- **Never trust `bundleHash` from the JSON blob.** Always recompute it from the raw fields. The hash field in the JSON is a convenience cache, not the source of truth.
- **Timestamp drift:** The on-chain verifier checks that `timestamp` falls within the escrow's valid window (`createdAt` to `createdAt + challengeWindow`). Bundles with timestamps outside this range are rejected.
- **Replay protection:** `taskId` is unique per escrow. The contract rejects duplicate evidence submissions for the same `taskId`.
- **Signer verification:** After computing `bundleHash`, the arbiter recovers the signer address from `signature` using `ecrecover` and checks it matches the address derived from `signerPubKey`. This confirms the seller who submitted the evidence is the one who signed it.
