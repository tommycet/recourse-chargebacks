/**
 * index.ts — Drop-in Express middleware that wraps an x402 seller endpoint
 * and produces cryptographic evidence bundles for every payment flow.
 *
 * Decorator pattern: `recourseWrap(app, { x402Endpoint })` wraps the existing
 * x402 handler without replacing it. It captures the incoming agent request,
 * lets the original handler run, then records the response + content hash,
 * signs an evidence bundle, and writes it to `evidence/`.
 *
 * If an agent later raises a dispute via POST /raise-dispute, a dispute
 * evidence file is written calling `raiseDispute`.
 */

import * as fs from "fs";
import * as path from "path";
import type { Express, Request, Response, NextFunction } from "express";

import {
  buildBundle,
  raiseDispute,
  disputeToJSON,
  keccak256Hex,
  sha256Hex,
  EvidenceBundle,
  EvidenceBundleInput,
  DisputeRecord,
} from "./evidence";

export interface RecourseWrapOptions {
  /** The x402 seller endpoint path to wrap (e.g. "/x402"). */
  x402Endpoint: string;
  /** Directory to write evidence files. Defaults to "./evidence". */
  evidenceDir?: string;
  /** Optional signer identifier recorded in bundles. */
  signer?: string;
  /** Optional signer function that produces a hex signature over the bundle hash. */
  sign?: (bundleHash: string) => Promise<string>;
  /** Optional logger; defaults to console. */
  log?: (msg: string) => void;
}

export interface RecourseContext {
  /** request digest captured before the handler runs */
  requestDigest: string;
  /** response digest + content digest captured after */
  responseDigest: string;
  contentDigest: string;
  /** the tx hash from the x402 payment response (if any) */
  txHash: string;
  /** timestamp of bundle creation */
  timestamp: number;
  /** signer identifier */
  signer: string;
  /** the signed evidence bundle */
  bundle: EvidenceBundle;
}

const DEFAULT_SIGNER = "0x0000000000000000000000000000000000000000";

function now(): number {
  return Date.now();
}

function digestBody(req: Request): string {
  const raw =
    typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body ?? "");
  return keccak256Hex(raw);
}

function digestResponse(res: Response, body: unknown): string {
  const raw =
    typeof body === "string"
      ? body
      : JSON.stringify(body ?? "");
  return keccak256Hex(raw);
}

function contentDigest(res: Response, body: unknown): string {
  const raw =
    typeof body === "string"
      ? body
      : JSON.stringify(body ?? "");
  return sha256Hex(raw);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJSONFile(dir: string, name: string, data: unknown): string {
  ensureDir(dir);
  const full = path.join(dir, name);
  fs.writeFileSync(full, JSON.stringify(data, null, 2), "utf8");
  return full;
}

/**
 * Wrap an Express app's x402 endpoint with evidence collection.
 *
 * Call this AFTER the real x402 route has been registered so we can locate
 * the matching layer and wrap it. The original handler is preserved; this
 * middleware only intercepts to capture request/response and write evidence.
 */
export function recourseWrap(app: Express, opts: RecourseWrapOptions): Express {
  const evidenceDir = path.resolve(opts.evidenceDir ?? "evidence");
  const log = opts.log ?? ((m: string) => console.log(`[recourse] ${m}`));
  const signer = opts.signer ?? DEFAULT_SIGNER;

  ensureDir(evidenceDir);

  const endpoint = opts.x402Endpoint;
  if (!endpoint) {
    throw new Error("recourseWrap: x402Endpoint is required");
  }

  // --- 1. Capture the incoming agent request ---------------------------
  app.use(endpoint, (req: Request, res: Response, next: NextFunction) => {
    const requestDigest = digestBody(req);
    const timestamp = now();

    // Capture the response body by hijacking res.send / res.json
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);

    let capturedBody: unknown = undefined;

    const capture = (body: unknown): unknown => {
      capturedBody = body;
      return body;
    };

    res.send = ((body?: unknown) => {
      capture(body);
      return originalSend(body);
    }) as typeof res.send;

    res.json = ((body?: unknown) => {
      capture(body);
      return originalJson(body);
    }) as typeof res.json;

    // Attach context for the post-handler evidence step
    (req as Request & { _recourse: unknown })._recourse = {
      requestDigest,
      timestamp,
      signer,
    };

    // Continue to the real x402 handler
    next();

    // --- 2 & 3. After the handler responds, build + sign the bundle ---
    // This runs after downstream handlers have sent the response.
    // We use res.on('finish') to be robust against async handlers.
    res.on("finish", async () => {
      try {
        const ctx = (req as Request & { _recourse?: unknown })._recourse as
          | { requestDigest: string; timestamp: number; signer: string }
          | undefined;

        if (!ctx) return;

        const responseDigest = digestResponse(res, capturedBody);
        const contentDigestVal = contentDigest(res, capturedBody);

        // Try to extract a txHash from the x402 payment response.
        // x402 responses typically include { payment: { txHash } } or
        // a header like x-payment-response.
        let txHash = "";
        if (capturedBody && typeof capturedBody === "object") {
          const cb = capturedBody as Record<string, unknown>;
          const payment = cb.payment as Record<string, unknown> | undefined;
          txHash =
            (payment?.txHash as string | undefined) ??
            (cb.txHash as string | undefined) ??
            (res.getHeader("x-payment-tx-hash") as string | undefined) ??
            "";
        }

        const input: EvidenceBundleInput = {
          requestDigest: ctx.requestDigest,
          responseDigest,
          contentDigest: contentDigestVal,
          txHash,
          timestamp: ctx.timestamp,
          signer: ctx.signer,
        };

        const bundle = buildBundle(input);

        // Sign the bundle hash if a signer function was provided.
        if (opts.sign) {
          try {
            bundle.signature = await opts.sign(bundle.hash());
          } catch (e) {
            log(`signing failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // --- 4. Write bundle to evidence/ file ---
        const ts = new Date(ctx.timestamp).toISOString().replace(/[:.]/g, "-");
        const fileName = `evidence-${ts}-${ctx.requestDigest.slice(0, 12)}.json`;
        const filePath = writeJSONFile(evidenceDir, fileName, bundle.toJSON());
        log(`wrote evidence bundle → ${filePath}`);
      } catch (e) {
        log(
          `evidence capture failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  });

  // --- 5. Dispute route ------------------------------------------------
  app.post(
    "/raise-dispute",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { bundle, reason } = req.body ?? {};
        if (!bundle || !reason) {
          res.status(400).json({ error: "bundle and reason required" });
          return;
        }

        // Reconstruct a bundle object from the submitted JSON so we can
        // call its hash() method and raiseDispute.
        const reconstructed = buildBundle({
          requestDigest: bundle.requestDigest,
          responseDigest: bundle.responseDigest,
          contentDigest: bundle.contentDigest,
          txHash: bundle.txHash ?? "",
          timestamp: bundle.timestamp,
          signer: bundle.signer ?? DEFAULT_SIGNER,
          signature: bundle.signature,
        });

        const dispute: DisputeRecord = raiseDispute(reconstructed, reason);
        const fileName = `dispute-${dispute.disputeId.slice(2, 18)}.json`;
        const filePath = writeJSONFile(
          evidenceDir,
          fileName,
          disputeToJSON(dispute),
        );
        log(`wrote dispute evidence → ${filePath}`);

        res.status(201).json({
          disputeId: dispute.disputeId,
          bundleHash: dispute.bundleHash,
          file: filePath,
        });
      } catch (e) {
        log(
          `dispute failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        res.status(500).json({ error: "dispute processing failed" });
      }
    },
  );

  log(`recourseWrap active on ${endpoint} (evidenceDir=${evidenceDir})`);
  return app;
}

export { buildBundle, raiseDispute, disputeToJSON, EvidenceBundle, DisputeRecord };
export type { EvidenceBundleInput, RecourseContext };
