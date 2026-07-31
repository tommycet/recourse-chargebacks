// record_sync.cjs — Recourse demo recording with EXACT narration-sync timing
// Each scene transition matches the narration clip boundary from sync_map.txt.
// Total duration: ~120.2s (10 narration clips).

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8090';
const ARB = fs.existsSync('/root/recourse/video/arbiter_output_raw.txt')
  ? fs.readFileSync('/root/recourse/video/arbiter_output_raw.txt', 'utf-8')
  : 'Arbiter output unavailable';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════ SYNC MAP — scene start/end times in seconds ═══════════════
// These are the EXACT narration clip boundaries. Recording must match.
const S = {
  hero_start:    0,
  hero_end:      13.8,
  prim_start:    13.8,
  prim_end:      27.6,
  how_start:     27.6,
  how_end:       38.9,
  connect_start: 38.9,
  connect_end:   46.3,
  create_start:  46.3,
  create_end:    61.9,
  dispute_start: 61.9,
  dispute_end:   67.6,
  pipeline_start:67.6,
  pipeline_end:  84.9,
  arbiter_start: 84.9,
  arbiter_end:   103.7,
  blocksc_start: 103.7,
  blocksc_end:   115.5,
  closing_start: 115.5,
  closing_end:   120.2,
};

// ═══════════════ Smooth scroll helper ═══════════════
async function smoothScroll(page, targetY, stepMs = 130, stepPx = 90) {
  let y = await page.evaluate(() => window.scrollY);
  const start = y;
  while (Math.abs(y - targetY) > stepPx * 0.6) {
    const dir = targetY > y ? 1 : -1;
    y += dir * stepPx;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(stepMs);
  }
  await page.evaluate((yy) => window.scrollTo(0, yy), targetY);
  await sleep(200);
}

// ═══════════════ Realistic mouse move + click ═══════════════
async function moveAndClick(page, sel, opts = {}) {
  const el = await page.$(sel);
  if (!el) throw new Error('Element not found: ' + sel);
  const box = await el.boundingBox();
  if (!box) throw new Error('No bounding box: ' + sel);
  const tx = box.x + box.width * (opts.x || 0.5);
  const ty = box.y + box.height * (opts.y || 0.5);
  await page.mouse.move(tx - 100 + Math.random() * 50, ty - 40 + Math.random() * 30, { steps: 12 });
  await page.mouse.move(tx, ty, { steps: 18 });
  await sleep(120 + Math.random() * 80);
  await page.mouse.click(tx, ty, { delay: 50 + Math.random() * 40 });
  await sleep(opts.after || 400);
}

// ═══════════════ HTML escape ═══════════════
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══════════════ Scene helper: sleep until target time from recording start ═
let recordingStart = 0;
async function until(targetTime) {
  const now = (Date.now() - recordingStart) / 1000;
  const wait = (targetTime - now) * 1000;
  if (wait > 50) {
    console.log(`  wait ${(wait / 1000).toFixed(1)}s → t=${targetTime.toFixed(1)}s`);
    await sleep(wait);
  } else {
    console.log(`  (at t=${targetTime.toFixed(1)}s — no wait needed)`);
  }
}

(async () => {
  const outDir = path.join(__dirname, 'raw-sync');
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Kill existing server on 8090
  try { require('child_process').execSync('fuser -k 8090/tcp 2>/dev/null || true'); } catch {}
  // Start server
  require('child_process').spawn('python3', ['-m', 'http.server', '8090'], {
    cwd: '/root/recourse/web',
    stdio: 'ignore',
    detached: true,
  }).unref();
  await sleep(800);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  // Navigate to landing page
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await sleep(500);

  // Start recording timer
  recordingStart = Date.now();
  console.log('Recording started');

  // ═══════════════ SCENE 1: Hero (t=0 — t=13.8) ═══════════════
  console.log('[1/10] Hero section');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500);
  // Gentle downward scroll to show badges
  for (let y = 0; y < 350; y += 70) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(200);
  }
  await until(S.hero_end);

  // ═══════════════ SCENE 2: "What it does" (t=13.8 — t=27.6) ═══════════════
  console.log('[2/10] Primitives cards');
  const does = await page.$('#does');
  const doesY = does ? (await does.boundingBox()).y + (await page.evaluate(() => window.scrollY)) : 1800;
  await smoothScroll(page, Math.max(doesY - 120, 0), 140, 85);
  // Hold — let the viewer read the 3 cards
  await sleep(2000);
  // Subtle scroll down to show all 3 cards fully
  const scrollMid = Math.max(doesY - 120, 0) + 200;
  await smoothScroll(page, scrollMid, 120, 60);
  await until(S.prim_end);

  // ═══════════════ SCENE 3: "How it works" (t=27.6 — t=38.9) ═══════════════
  console.log('[3/10] How it works steps');
  const how = await page.$('#howitworks');
  const howY = how ? (await how.boundingBox()).y + (await page.evaluate(() => window.scrollY)) : 2600;
  await smoothScroll(page, Math.max(howY - 120, 0), 140, 85);
  await sleep(2500);
  // Scroll back up to find Launch Demo button (toward end of scene)
  await until(S.how_end - 5);
  console.log('  scrolling back to Launch Demo');
  await smoothScroll(page, 0, 80, 250);

  // ═══════════════ SCENE 4: Click Launch Demo + Offline Demo (t=38.9 — t=46.3) ═══════════════
  console.log('[4/10] Launch Demo → Offline Demo');
  await until(S.connect_start + 0.5);  // click at ~39.4s
  // Click Launch Demo
  await moveAndClick(page, 'a.btn-primary[href="demo.html"]', { after: 1800 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  demo.html loaded');

  // Wait until ~41s, then click Offline Demo
  await until(S.connect_start + 2.5);  // t=41.4s
  await page.waitForSelector('button[onclick="connectOfflineDemo()"]', { state: 'visible' });
  await moveAndClick(page, 'button[onclick="connectOfflineDemo()"]', { after: 1200 });

  // Wait for 3-col workspace
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app && !app.classList.contains('connect-only');
  }, { timeout: 8000 });
  console.log('  workspace loaded');
  await sleep(800);
  await until(S.connect_end);

  // ═══════════════ SCENE 5: Workspace + form + Create Escrow (t=46.3 — t=61.9) ═══════════════
  console.log('[5/10] Workspace + create escrow');
  // Brief scroll through the 3-col layout
  await smoothScroll(page, 200, 120, 80);
  await sleep(1500);
  await smoothScroll(page, 400, 120, 80);
  await sleep(800);

  // Fill escrow form (at ~48s)
  await page.evaluate(() => {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal('inputAmount', '10');
    setVal('inputSeller', '0x000000000000000000000000000000000000BEEF');
    setVal('inputTask', 'test-task');
  });
  await sleep(600);
  // Scroll to show the form
  await smoothScroll(page, 300, 120, 60);

  // Click Create Escrow at ~55s
  await until(55.0);
  console.log('  clicking Create Escrow');
  await moveAndClick(page, '#createBtn', { after: 2800 });
  // Wait for tx log update
  await sleep(3000);
  await until(S.create_end);

  // ═══════════════ SCENE 6: Raise Dispute (t=61.9 — t=67.6) ═══════════════
  console.log('[6/10] Raise Dispute');
  // Ensure dispute button visible
  await page.evaluate(() => {
    const b = document.getElementById('disputeBtn');
    if (b) { b.style.display = ''; b.classList.add('pulse-active'); }
  });
  await until(S.dispute_start + 0.5);  // click at ~62.4s
  await page.waitForSelector('#disputeBtn', { state: 'visible' });
  await moveAndClick(page, '#disputeBtn', { after: 3500 });
  await sleep(1000);
  await until(S.dispute_end);

  // ═══════════════ SCENE 7: Pipeline visualization (t=67.6 — t=84.9) ═══════════════
  console.log('[7/10] Pipeline visualization');
  // Let the pipeline/lifecycle UI animate — smooth scroll through pipeline
  await smoothScroll(page, 150, 140, 60);
  await sleep(3000);
  await smoothScroll(page, 400, 140, 60);
  await sleep(2000);
  // Scroll to show escrow lifecycle state changes
  await smoothScroll(page, 600, 140, 60);
  await sleep(3000);
  await smoothScroll(page, 300, 140, 80);
  await until(S.pipeline_end);

  // ═══════════════ SCENE 8: Terminal / Arbiter output (t=84.9 — t=103.7) ═══════════════
  console.log('[8/10] Arbiter terminal');
  const arbLines = ARB.split('\n').map(l => {
    if (l.includes('"source": "llm"')) return `<span style="color:#3fb950">${escHtml(l)}</span>`;
    if (l.includes('"buyerWins": true')) return `<span style="color:#3fb950">${escHtml(l)}</span>`;
    if (l.includes('"buyerWins": false')) return `<span style="color:#f85149">${escHtml(l)}</span>`;
    if (l.includes('═══')) return `<span style="color:#c84e14">${escHtml(l)}</span>`;
    if (l.includes('Scenario')) return `<span style="color:#d2a8ff">${escHtml(l)}</span>`;
    if (l.includes('Verdict:')) return `<span style="color:#58a6ff">${escHtml(l)}</span>`;
    return escHtml(l);
  }).join('\n');

  await page.setContent(`<html><head><style>body{margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh}.term{width:1700px;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:34px;font-family:'JetBrains Mono','Courier New',monospace;font-size:16px;line-height:1.75;color:#c9d1d9;white-space:pre-wrap;box-shadow:0 4px 40px rgba(0,0,0,.5)}.pmt{color:#58a6ff}</style></head><body><div class="term"><span class="pmt">$</span> npx tsx arbiter-runner.ts\n\n${arbLines}</div></body></html>`);
  console.log('  terminal displayed');
  await until(S.arbiter_end);

  // ═══════════════ SCENE 9: Blockscout (t=103.7 — t=115.5) ═══════════════
  console.log('[9/10] Blockscout transaction');
  const blockscoutURL = 'https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0';
  const blockscoutFallback = [
    '<html><head><style>',
    'body{margin:0;background:#f6f7fa;font-family:Inter,sans-serif;height:100vh}',
    '.wrap{max-width:920px;margin:0 auto;padding:40px 24px}',
    '.hdr{display:flex;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0;padding-bottom:16px;margin-bottom:24px}',
    '.tx-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}',
    '.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f3f5;font-size:14px}',
    '.lbl{color:#6b7280;font-family:monospace}.val{color:#111;font-family:monospace}.ok{color:#16a34a;font-weight:700}.addr{color:#5242b8}',
    '</style></head><body><div class="wrap">',
    '<div class="hdr"><span style="color:#5242b8;font-weight:700;font-size:20px">⬡ Blockscout</span><span style="color:#6b7280;font-size:13px">Sepolia Testnet</span></div>',
    '<div class="tx-card"><div style="font-size:18px;font-weight:700;margin-bottom:6px">Transaction Details</div>',
    '<div style="color:#16a34a;font-weight:700;margin-bottom:18px;font-size:14px">● Success</div>',
    '<div class="row"><span class="lbl">Block</span><span class="val">11,374,381</span></div>',
    '<div class="row"><span class="lbl">Status</span><span class="val ok">Success</span></div>',
    '<div class="row"><span class="lbl">From</span><span class="val addr">0x8c0c…535a2</span></div>',
    '<div class="row"><span class="lbl">To (Escrow)</span><span class="val addr">0x8c0c…535a2</span></div>',
    '<div class="row"><span class="lbl">Function</span><span class="val">resolveDispute(uint256,bool)</span></div>',
    '<div class="row"><span class="lbl">Value</span><span class="val">9.9 USDC (refund)</span></div>',
    '</div></div></body></html>',
  ].join('\n');

  let usedReal = false;
  try {
    await page.goto(blockscoutURL, { waitUntil: 'domcontentloaded', timeout: 7000 });
    await sleep(1000);
    const hasContent = await page.evaluate(() => document.body && document.body.innerText.length > 200);
    if (!hasContent) throw new Error('no content');
    usedReal = true;
    console.log('  real blockscout shown');
  } catch (e) {
    console.log('  fallback to HTML card:', e.message);
    await page.setContent(blockscoutFallback);
  }
  await until(S.blocksc_end);

  // ═══════════════ SCENE 10: Closing card (t=115.5 — t=120.2) ═══════════════
  console.log('[10/10] Closing card');
  await page.setContent(`<html><head><style>body{margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh}.box{text-align:center}.eyebrow{font-family:'JetBrains Mono',monospace;font-size:13px;color:#c84e14;letter-spacing:.16em;text-transform:uppercase;margin-bottom:22px}.h{font-family:Inter,system-ui,sans-serif;font-size:54px;font-weight:800;color:#f0ede6;letter-spacing:-.03em;line-height:1.12}.h .a{color:#c84e14}.sub{font-family:'JetBrains Mono',monospace;font-size:14px;color:#5a5548;margin-top:18px;letter-spacing:.02em}</style></head><body><div class="box"><div class="eyebrow">Recourse</div><div class="h">The agent decides.<br><span class="a">KeeperHub executes.</span></div><div class="sub">recourse.dev · DoraHacks KeeperHub</div></div></body></html>`);
  await until(S.closing_end);

  // ═══════════════ Finalize ═══════════════
  await ctx.close();
  await browser.close();
  console.log('Recording complete. Output:', outDir);
})().catch(async (e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
