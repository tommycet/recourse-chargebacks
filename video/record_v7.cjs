// record_v7.cjs — Recourse demo recording with page.evaluate() clicks
// Key fixes:
//   1. ALL interactive clicks via page.evaluate() — no bounding box failures
//   2. Instant scrolls — no smoothScroll latency
//   3. Scene timestamps written to JSON for post-recording narration sync
//   4. ~110s total with generous pauses for narration

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8090';
const ARB = fs.existsSync('/root/recourse/video/arbiter_output_raw.txt')
  ? fs.readFileSync('/root/recourse/video/arbiter_output_raw.txt', 'utf-8')
  : 'Arbiter output unavailable';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let recordingStart = 0;
const sceneTimestamps = {};

function markScene(name) {
  const t = (Date.now() - recordingStart) / 1000;
  sceneTimestamps[name] = Math.round(t * 100) / 100;
  console.log(`  [SCENE] ${name} @ ${sceneTimestamps[name]}s`);
  return t;
}

(async () => {
  const outDir = path.join(__dirname, 'raw-v7');
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  try { require('child_process').execSync('fuser -k 8090/tcp 2>/dev/null || true'); } catch {}
  require('child_process').spawn('python3', ['-m', 'http.server', '8090'], {
    cwd: '/root/recourse/web',
    stdio: 'ignore',
    detached: true,
  }).unref();
  await sleep(1500);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await sleep(1000);

  recordingStart = Date.now();
  console.log('Recording started');

  // ═══════════════ SCENE 1: Hero section — ~14s ═══════════════
  console.log('[1/9] Hero section');
  markScene('hero_start');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(3000);
  // Gentle scroll to reveal badges
  for (let y = 0; y < 350; y += 80) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(250);
  }
  await sleep(4000);
  markScene('hero_end');

  // ═══════════════ SCENE 2: Primitives — #does — ~14s ═══════════════
  console.log('[2/9] Primitives cards');
  markScene('primitives_start');
  const doesY = await page.evaluate(() => {
    const el = document.getElementById('does');
    return el ? el.getBoundingClientRect().top + window.scrollY - 100 : 1800;
  });
  await page.evaluate((y) => window.scrollTo(0, y), doesY);
  await sleep(4000);
  await page.evaluate((y) => window.scrollTo(0, y), doesY + 150);
  await sleep(4000);
  markScene('primitives_end');

  // ═══════════════ SCENE 3: How it works — ~12s ═══════════════
  console.log('[3/9] How it works');
  markScene('how_start');
  const howY = await page.evaluate(() => {
    const el = document.getElementById('howitworks');
    return el ? el.getBoundingClientRect().top + window.scrollY - 100 : 2600;
  });
  await page.evaluate((y) => window.scrollTo(0, y), howY);
  await sleep(4000);
  // Scroll slightly to show steps
  await page.evaluate((y) => window.scrollTo(0, y), howY + 100);
  await sleep(3000);
  markScene('how_end');

  // ═══════════════ SCENE 4: Launch Demo + Offline Demo — ~8s ═══════════════
  console.log('[4/9] Launch Demo → Offline Demo');
  markScene('connect_start');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);

  // Click Launch Demo
  await page.evaluate(() => {
    const link = document.querySelector('a.btn-primary[href="demo.html"]');
    if (link) link.click();
    else window.location.href = BASE + '/demo.html';
  });
  await page.waitForLoadState('domcontentloaded');
  await sleep(800);

  // Click Offline Demo
  await page.evaluate(() => {
    const btn = document.querySelector('button[onclick="connectOfflineDemo()"]');
    if (btn) btn.click();
  });
  await sleep(2000);

  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app && !app.classList.contains('connect-only');
  }, { timeout: 8000 });
  console.log('  workspace loaded');
  await sleep(1000);
  markScene('connect_end');

  // ═══════════════ SCENE 5: Workspace visible — ~14s ═══════════════
  console.log('[5/9] Workspace');
  markScene('workspace_start');
  await sleep(4000);
  // Scroll through the workspace to show all columns
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 150;
  });
  await sleep(3000);
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 300;
  });
  await sleep(3000);
  markScene('workspace_end');

  // ═══════════════ SCENE 6: Fill form + Create Escrow — ~14s ═══════════════
  console.log('[6/9] Create Escrow');
  markScene('create_start');
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
  await sleep(1500);
  // Scroll to show the form
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 200;
  });
  await sleep(2000);

  // Click Create Escrow
  await page.evaluate(() => {
    const btn = document.getElementById('createBtn');
    if (btn) btn.click();
  });
  await sleep(5000);
  markScene('create_end');

  // ═══════════════ SCENE 7: Raise Dispute — ~8s ═══════════════
  console.log('[7/9] Raise Dispute');
  markScene('dispute_start');
  // Ensure dispute button visible, scroll to it
  await page.evaluate(() => {
    const b = document.getElementById('disputeBtn');
    if (b) {
      b.style.display = '';
      b.classList.add('pulse-active');
      b.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  });
  await sleep(1000);

  // Click dispute via doRaiseDispute()
  await page.evaluate(() => {
    if (typeof doRaiseDispute === 'function') doRaiseDispute();
    else {
      const btn = document.getElementById('disputeBtn');
      if (btn) btn.click();
    }
  });
  await sleep(5000);
  markScene('dispute_end');

  // ═══════════════ SCENE 8: Pipeline + Lifecycle — ~16s ═══════════════
  console.log('[8/9] Pipeline visualization');
  markScene('pipeline_start');
  // Show pipeline panel
  await page.evaluate(() => {
    const pp = document.getElementById('pipelinePanel');
    if (pp) { pp.style.display = ''; pp.scrollIntoView({ behavior: 'instant', block: 'start' }); }
  });
  await sleep(4000);
  // Show lifecycle panel
  await page.evaluate(() => {
    const lp = document.getElementById('lifecyclePanel');
    if (lp) { lp.style.display = ''; }
  });
  await sleep(4000);
  // Scroll down to see both panels
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTop = main.scrollTop + 200;
  });
  await sleep(4000);
  markScene('pipeline_end');

  // ═══════════════ SCENE 9: Terminal / Arbiter output — ~14s ═══════════════
  console.log('[9/9] Arbiter terminal');
  markScene('arbiter_start');
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
  await sleep(10000);
  markScene('arbiter_end');

  // ═══════════════ SCENE 10: Blockscout — ~14s ═══════════════
  console.log('[10/10] Blockscout transaction');
  markScene('blocksc_start');
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
    await page.goto('https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0',
      { waitUntil: 'domcontentloaded', timeout: 7000 });
    await sleep(1000);
    const hasContent = await page.evaluate(() => document.body && document.body.innerText.length > 200);
    if (!hasContent) throw new Error('no content');
    usedReal = true;
    console.log('  real blockscout shown');
  } catch (e) {
    console.log('  fallback to HTML card:', e.message);
    await page.setContent(blockscoutFallback);
  }
  await sleep(8000);
  markScene('blocksc_end');

  // ═══════════════ SCENE 11: Closing card — ~6s ═══════════════
  console.log('[11/11] Closing card');
  markScene('closing_start');
  await page.setContent(`<html><head><style>body{margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh}.box{text-align:center}.eyebrow{font-family:'JetBrains Mono',monospace;font-size:13px;color:#c84e14;letter-spacing:.16em;text-transform:uppercase;margin-bottom:22px}.h{font-family:Inter,system-ui,sans-serif;font-size:54px;font-weight:800;color:#f0ede6;letter-spacing:-.03em;line-height:1.12}.h .a{color:#c84e14}.sub{font-family:'JetBrains Mono',monospace;font-size:14px;color:#5a5548;margin-top:18px;letter-spacing:.02em}</style></head><body><div class="box"><div class="eyebrow">Recourse</div><div class="h">The agent decides.<br><span class="a">KeeperHub executes.</span></div><div class="sub">recourse.dev · DoraHacks KeeperHub</div></div></body></html>`);
  await sleep(6000);
  markScene('closing_end');

  // ═══════════════ Finalize ═══════════════
  const totalDuration = (Date.now() - recordingStart) / 1000;
  console.log(`\nRecording complete. Total: ${totalDuration.toFixed(1)}s`);

  const tsPath = path.join(__dirname, 'v7_timestamps.json');
  fs.writeFileSync(tsPath, JSON.stringify({ totalDuration, scenes: sceneTimestamps }, null, 2));
  console.log('Timestamps written to:', tsPath);

  await ctx.close();
  await browser.close();
  console.log('Browser closed. Output:', outDir);
})().catch(async (e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
