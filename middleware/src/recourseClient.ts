/**
 * recourseClient.ts — High-level client wrapping the x402 fetch pattern with
 * RecourseEscrow-backed delivery guarantees.
 *
 * Flow:
 *   1. Approve USDC allowance to escrow contract.
 *   2. Create escrow (buyer=signer, seller=derived from x402 response).
 *   3. Fetch the URL via x402 (sends USDC payment header in request).
 *   4. Poll for delivery confirmation.
 *   5. On timeout → build dispute evidence bundle and raise dispute on-chain.
 *
 * Uses ethers v5.
 */

import { ethers } from "ethers";
import { buildBundle, hashBundle, EvidenceBundleV2 } from "./evidenceBundle.ts";
import { verifyBundle } from "./evidenceVerifier.ts";

/* ------------------------------------------------------------------ */
/*  Minimal ABIs                                                         */
/* ------------------------------------------------------------------ */

const ESCROW_ABI = [
  "function createEscrow(address buyer, address seller, uint256 amount, bytes32 taskId, bytes32 evidenceBundleHash) returns (uint256 id)",
  "function confirmDelivery(uint256 id, bytes32 evidenceHash)",
  "function raiseDispute(uint256 id, bytes32 disputeEvidenceHash)",
  "function statusOf(uint256 id) view returns (uint8)",
  "event EscrowCreated(uint256 indexed id, address indexed buyer, address indexed seller, uint256 amount, bytes32 taskId, bytes32 evidenceHash)",
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface RecourseClientConfig {
  rpcUrl: string;
  privateKey: string;
  escrowAddr: string;
  usdcAddr: string;
  /** Arbiter address (used as sellerAddr placeholder if 402 header absent). */
  arbiterAddr: string;
}

export interface PayResult {
  escrowId: ethers.BigNumber;
  bundleHash: string;
  responseBody: string;
  deliveryStatus: "delivered" | "failed" | "partial";
  disputed: boolean;
}

/* ------------------------------------------------------------------ */
/*  RecourseClient                                                      */
/* ------------------------------------------------------------------ */

export class RecourseClient {
  private provider: ethers.providers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private escrow: ethers.Contract;
  private usdc: ethers.Contract;
  private arbiterAddr: string;

  constructor(config: RecourseClientConfig) {
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    this.signer = new ethers.Wallet(config.privateKey, this.provider);
    this.escrow = new ethers.Contract(
      config.escrowAddr,
      ESCROW_ABI,
      this.signer,
    );
    this.usdc = new ethers.Contract(config.usdcAddr, USDC_ABI, this.signer);
    this.arbiterAddr = config.arbiterAddr;
  }

  /**
   * Pay for a service at `url` with USDC-backed recourse.
   *
   * @param url         - The x402 seller endpoint URL.
   * @param amount      - Payment amount in USDC base units (e.g. 1_000_000 = $1).
   * @param taskDesc    - Human-readable task description (hashed into taskId bytes32).
   * @param timeoutMs   - Milliseconds before the client raises a dispute.
   */
  async payWithRecourse(
    url: string,
    amount: bigint,
    taskDesc: string,
    timeoutMs: number,
  ): Promise<PayResult> {
    const buyerAddr = await this.signer.getAddress();
    const amountBN = ethers.BigNumber.from(amount);

    /* ---- 1. Build preliminary evidence bundle (pre-delivery) ---------- */
    const requestHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(url + taskDesc),
    );
    const taskIdBytes32 = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(taskDesc),
    );
    const timestamp = Math.floor(Date.now() / 1000);

    // signerPubKey: compress the secp256k1 public key to 32 bytes (take X coordinate)
    const signerPubKey = ethers.utils.computePublicKey(this.signer.privateKey);

    const prelimBundle: EvidenceBundleV2 = buildBundle({
      version: 1,
      taskId: taskIdBytes32,
      buyerAddr,
      sellerAddr: this.arbiterAddr, // will be updated after x402 response
      amount,
      requestHash,
      responseHash: ethers.constants.HashZero, // not known yet
      deliveryStatus: "failed", // pessimistic until confirmed
      timestamp,
      signerPubKey,
    });
    const prelimHash = hashBundle(prelimBundle);

    /* ---- 2. Approve USDC ------------------------------------------------ */
    const currentAllowance: ethers.BigNumber = await this.usdc.allowance(
      buyerAddr,
      this.escrow.address,
    );
    if (currentAllowance.lt(amountBN)) {
      const approveTx = await this.usdc.approve(
        this.escrow.address,
        amountBN,
      );
      await approveTx.wait();
    }

    /* ---- 3. Create escrow ---------------------------------------------- */
    const createTx = await this.escrow.createEscrow(
      buyerAddr,
      this.arbiterAddr,
      amountBN,
      taskIdBytes32,
      prelimHash,
    );
    const createReceipt = await createTx.wait();

    // Extract escrow ID from EscrowCreated event
    const escrowCreatedTopic = this.escrow.interface.getEventTopic(
      "EscrowCreated",
    );
    const log = createReceipt.logs.find(
      (l: { topics: string[] }) => l.topics[0] === escrowCreatedTopic,
    );
    const escrowId: ethers.BigNumber = log
      ? ethers.BigNumber.from(log.topics[1])
      : ethers.BigNumber.from(0);

    /* ---- 4. x402 fetch ------------------------------------------------- */
    let responseBody = "";
    let sellerAddr = this.arbiterAddr;
    let fetchError: Error | null = null;

    try {
      const controller = new AbortController();
      const fetchTimer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Payment": JSON.stringify({
            escrowId: escrowId.toString(),
            amount: amount.toString(),
            taskId: taskIdBytes32,
          }),
        },
        body: JSON.stringify({ task: taskDesc }),
        signal: controller.signal,
      });
      clearTimeout(fetchTimer);

      responseBody = await response.text();

      // x402 seller may identify itself in headers
      const sellerHeader = response.headers.get("x-seller-address");
      if (sellerHeader) sellerAddr = sellerHeader;
    } catch (err) {
      fetchError = err instanceof Error ? err : new Error(String(err));
    }

    /* ---- 5. Build final evidence bundle -------------------------------- */
    const responseHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(responseBody),
    );
    const deliveryStatus = fetchError ? "failed" : "delivered";

    const finalBundle: EvidenceBundleV2 = buildBundle({
      version: 1,
      taskId: taskIdBytes32,
      buyerAddr,
      sellerAddr,
      amount,
      requestHash,
      responseHash,
      deliveryStatus,
      timestamp,
      signerPubKey,
    });
    const bundleHash = hashBundle(finalBundle);

    /* ---- 6. Poll for delivery or raise dispute on timeout -------------- */
    let disputed = false;

    if (!fetchError) {
      // Delivery succeeded — confirm on-chain
      try {
        const confirmTx = await this.escrow.confirmDelivery(
          escrowId,
          bundleHash,
        );
        await confirmTx.wait();
      } catch (err) {
        console.warn("[RecourseClient] confirmDelivery failed:", err);
      }
    } else {
      // Timeout / error — raise dispute with failure bundle
      const disputeBundle: EvidenceBundleV2 = buildBundle({
        ...finalBundle,
        deliveryStatus: "failed",
      });
      const disputeHash = hashBundle(disputeBundle);

      try {
        const disputeTx = await this.escrow.raiseDispute(
          escrowId,
          disputeHash,
        );
        await disputeTx.wait();
        disputed = true;
      } catch (err) {
        console.warn("[RecourseClient] raiseDispute failed:", err);
      }
    }

    return {
      escrowId,
      bundleHash,
      responseBody,
      deliveryStatus: fetchError ? "failed" : "delivered",
      disputed,
    };
  }

  /**
   * Verify a bundle against a hash retrieved from the chain.
   */
  verifyDelivery(bundle: EvidenceBundleV2, onChainHash: string): boolean {
    return verifyBundle(bundle, onChainHash);
  }
}
