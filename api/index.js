import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Hash helpers ────────────────────────────────────────────
function keccak256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return '0x' + createHash('sha3-256').update(bytes).digest('hex');
}

function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return '0x' + createHash('sha256').update(bytes).digest('hex');
}

// ─── Helper: send JSON ───────────────────────────────────────
function sendJSON(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// ─── Helper: read body ───────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

// ─── Main handler ────────────────────────────────────────────
export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') return sendJSON(res, 204, {});

  // ── Health check ──
  if (path === '/api/health' && method === 'GET') {
    return sendJSON(res, 200, { status: 'ok', service: 'recourse', deployedAt: '2026-07-31' });
  }

  // ── Evidence bundle ──
  if (path === '/api/bundle' && method === 'POST') {
    const body = await readBody(req);
    const { requestDigest, responseDigest, contentDigest, txHash, timestamp, signer } = body;
    if (!requestDigest || !responseDigest || !contentDigest) {
      return sendJSON(res, 400, { error: 'missing required fields: requestDigest, responseDigest, contentDigest' });
    }
    const input = {
      rulebookVersion: 'v1.0',
      requestDigest,
      responseDigest,
      contentDigest,
      txHash: txHash || '',
      timestamp: timestamp || Date.now(),
      signer: signer || '0x0000000000000000000000000000000000000000',
    };
    const bundleHash = keccak256Hex(JSON.stringify(input));
    return sendJSON(res, 200, { bundle: input, bundleHash });
  }

  // ── Raise dispute ──
  if (path === '/api/dispute' && method === 'POST') {
    const body = await readBody(req);
    const { bundle, reason } = body;
    if (!bundle || !reason) {
      return sendJSON(res, 400, { error: 'missing bundle or reason' });
    }
    const bundleHash = keccak256Hex(JSON.stringify(bundle));
    const disputeId = keccak256Hex(JSON.stringify({ bundleHash, reason, raisedAt: Date.now() }));
    return sendJSON(res, 200, { disputeId, bundleHash, reason, raisedAt: Date.now(), bundle });
  }

  // ── Deployed contract info ──
  if (path === '/api/deployed' && method === 'GET') {
    const deployedPath = join(ROOT, 'web', 'deployed.json');
    if (existsSync(deployedPath)) {
      try {
        const data = JSON.parse(readFileSync(deployedPath, 'utf-8'));
        return sendJSON(res, 200, data);
      } catch (e) {
        // fall through to defaults
      }
    }
    return sendJSON(res, 200, {
      address: '0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2',
      chainId: 11155111,
      network: 'Sepolia',
      arbiter: '0x7532A98C8eA413157787C8D2dA9659cD86D3acCe',
    });
  }

  // ── Demo evidence sample ──
  if (path === '/api/evidence/sample' && method === 'GET') {
    return sendJSON(res, 200, {
      requestDigest: '0x' + 'a'.repeat(64),
      responseDigest: '0x' + 'b'.repeat(64),
      contentDigest: '0x' + 'c'.repeat(64),
      txHash: '0x7a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7',
      timestamp: Date.now(),
      signer: '0x7532A98C8eA413157787C8D2dA9659cD86D3acCe',
      bundleHash: '0x' + 'd'.repeat(64),
    });
  }

  // ── 404 ──
  return sendJSON(res, 404, { error: 'Not found', path });
}
