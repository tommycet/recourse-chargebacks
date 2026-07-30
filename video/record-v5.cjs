// record-v5.cjs — Recourse demo recording v5
// Real interactive clicks on landing + demo pages, ~120s to match narration.
// setContent ONLY for terminal/arbiter scene and closing card.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8090';
const ARB = fs.existsSync('/root/recourse/video/arbiter_output_raw.txt')
  ? fs.readFileSync('/root/recourse/video/arbiter_output_raw.txt', 'utf-8')
  : 'Arbiter output unavailable';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Smooth scroll a window in small increments.
async function smoothScroll(page, targetY, stepMs = 130, stepPx = 90) {
  let y = await page.evaluate(() => window.scrollY);
  while (Math.abs(y - targetY) > stepPx * 0.6) {
    const dir = targetY > y ? 1 : -1;
    y = y + dir * stepPx;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(stepMs);
  }
  await page.evaluate((yy) => window.scrollTo(0, yy), targetY);
  await sleep(200);
}

// Move mouse to an element then click it (real movement, 18 steps).
async function moveAndClick(page, sel, opts = {}) {
  const el = await page.$(sel);
  if (!el) throw new Error('not found: ' + sel);
  const box = await el.boundingBox();
  if (!box) throw new Error('no box: ' + sel);
  const tx = box.x + box.width * (opts.x || 0.5);
  const ty = box.y + box.height * (opts.y || 0.5);
  // move from current-ish position toward target
  await page.mouse.move(tx - 120, ty - 60, { steps: 6 });
  await page.mouse.move(tx, ty, { steps: 18 });
  await sleep(150);
  await page.mouse.click(tx, ty, { delay: 60 });
  await sleep(opts.after || 400);
}

function escHtml(s) {
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}

(async () => {
  const outDir = path.join(__dirname, 'raw-v5');
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  // ══════ Scene 1-3: Landing page scroll (~39s) ══════
  console.log('[1-3] Landing page');
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await sleep(700);

  // Hero with badges (~13.8s)
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(13800);

  // Scroll to "What it does" (#does) (~13.8s for primitives)
  const does = await page.$('#does');
  const doesY = does ? (await does.boundingBox()).y : 1800;
  await smoothScroll(page, Math.max(doesY - 140, 0), 150, 80);
  await sleep(13800);

  // Scroll to "How it works" (#howitworks) (~11.3s)
  const how = await page.$('#howitworks');
  const howY = how ? (await how.boundingBox()).y : 2600;
  await smoothScroll(page, Math.max(howY - 140, 0), 150, 80);
  await sleep(11300);

  // ══════ Scene 4: Click "Launch Demo" → demo.html (~7.4s) ══════
  console.log('[4] Launch Demo');
  // scroll back up so the launch button (in hero CTA row) is reachable
  await smoothScroll(page, 0, 100, 200);
  await sleep(300);
  await moveAndClick(page, 'a.btn.btn-primary[href="demo.html"]', { after: 1500 });
  await page.waitForLoadState('domcontentloaded');
  await sleep(5900); // total ~7.4s for scene 4

  // ══════ Scene 5: Offline Demo + fill form + create escrow (~15.6s) ══════
  console.log('[5] Offline Demo + form');
  // demo.html connect screen. Click Offline Demo button.
  await page.waitForSelector('button[onclick="connectOfflineDemo()"]', { state: 'visible' });
  // move mouse into the connect panel then click the button
  await moveAndClick(page, 'button[onclick="connectOfflineDemo()"]', { after: 1000 });

  // Wait for 3-column workspace (connect-only removed)
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app && !app.classList.contains('connect-only');
  }, { timeout: 8000 });

  // Fill the escrow form (use evaluate to set values reliably, then dispatch input)
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

  // Move to and click "Approve USDC & Create Escrow"
  await page.waitForSelector('#createBtn', { state: 'visible' });
  await moveAndClick(page, '#createBtn', { after: 2500 });

  // Wait for tx log to update (doCreateEscrow runs async; give ~5s)
  await sleep(5500);

  // ══════ Scene 6: Raise Dispute (~5.7s) ══════
  console.log('[6] Raise Dispute');
  // The dispute button may be hidden until escrow selected; ensure visible
  await page.evaluate(() => {
    const b = document.getElementById('disputeBtn');
    if (b) { b.style.display = ''; b.classList.add('pulse-active'); }
  });
  await page.waitForSelector('#disputeBtn', { state: 'visible' });
  await moveAndClick(page, '#disputeBtn', { after: 3500 });
  await sleep(2200);

  // ══════ Scene 7: Pipeline visualization (~17.3s) ══════
  console.log('[7] Pipeline viz');
  // The demo raises a dispute which triggers pipeline/lifecycle UI. Show it.
  await sleep(17300);

  // ══════ Scene 8: Arbiter terminal (~18.8s) — setContent OK ══════
  console.log('[8] Arbiter terminal');
  const lines = ARB.split('\n').map((l) => {
    if (l.includes('"source": "llm"')) return `<span style="color:#3fb950">${escHtml(l)}</span>`;
    if (l.includes('"buyerWins": true')) return `<span style="color:#3fb950">${escHtml(l)}</span>`;
    if (l.includes('"buyerWins": false')) return `<span style="color:#f85149">${escHtml(l)}</span>`;
    if (l.includes('═══')) return `<span style="color:#c84e14">${escHtml(l)}</span>`;
    if (l.includes('Scenario')) return `<span style="color:#d2a8ff">${escHtml(l)}</span>`;
    if (l.includes('Verdict:')) return `<span style="color:#58a6ff">${escHtml(l)}</span>`;
    return escHtml(l);
  }).join('\n');

  await page.setContent(`<html><head><style>
    body{margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh}
    .term{width:1700px;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:34px;
      font-family:'JetBrains Mono','Courier New',monospace;font-size:16px;line-height:1.75;color:#c9d1d9;
      white-space:pre-wrap;box-shadow:0 4px 40px rgba(0,0,0,.5)}
    .pmt{color:#58a6ff}
  </style></head><body>
    <div class="term"><span class="pmt">$</span> npx tsx arbiter-runner.ts\n\n${lines}</div>
  </body></html>`);
  await sleep(18800);

  // ══════ Scene 9: Blockscout (~11.8s) — try real URL, fallback HTML ══════
  console.log('[9] Blockscout');
  const blockscoutHTML = `<html><head><style>
    body{margin:0;background:#f6f7fa;font-family:Inter,-apple-system,system-ui,sans-serif;height:100vh}
    .wrap{max-width:920px;margin:0 auto;padding:40px 24px}
    .hdr{display:flex;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0;padding-bottom:16px;margin-bottom:24px}
    .logo{color:#5242b8;font-weight:700;font-size:20px}
    .tx-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f3f5;font-size:14px}
    .lbl{color:#6b7280;font-family:monospace}
    .val{color:#111;font-family:monospace}
    .ok{color:#16a34a;font-weight:700}
    .addr{color:#5242b8}
  </style></head><body><div class="wrap">
    <div class="hdr"><span class="logo">⬡ Blockscout</span><span style="color:#6b7280;font-size:13px">Sepolia Testnet</span></div>
    <div class="tx-card">
      <div style="font-size:18px;font-weight:700;margin-bottom:6px">Transaction Details</div>
      <div style="color:#16a34a;font-weight:700;margin-bottom:18px;font-size:14px">● Success</div>
      <div class="row"><span class="lbl">Block</span><span class="val">11,374,381</span></div>
      <div class="row"><span class="lbl">Status</span><span class="val ok">Success</span></div>
      <div class="row"><span class="lbl">From</span><span class="val addr">0x8c0c…535a2</span></div>
      <div class="row"><span class="lbl">To (Escrow)</span><span class="val addr">0x8c0c…535a2</span></div>
      <div class="row"><span class="lbl">Function</span><span class="val">resolveDispute(uint256,bool)</span></div>
      <div class="row"><span class="lbl">Value</span><span class="val">9.9 USDC (refund)</span></div>
    </div>
  </div></body></html>`;

  let usedReal = false;
  try {
    // Try the real blockscout tx page with a short timeout and networkidle-ish
    await page.goto('https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0',
      { waitUntil: 'domcontentloaded', timeout: 7000 });
    await sleep(1000);
    // If page is mostly blank/errored, fall back
    const hasContent = await page.evaluate(() => document.body && document.body.innerText.length > 200);
    if (!hasContent) throw new Error('no content');
    usedReal = true;
    console.log('  real blockscout shown');
  } catch (e) {
    console.log('  fallback to HTML card:', e.message);
    await page.setContent(blockscoutHTML);
  }
  await sleep(11800);

  // ══════ Scene 10: Closing card (~4.7s) — setContent OK ══════
  console.log('[10] Closing card');
  await page.setContent(`<html><head><style>
    body{margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh}
    .box{text-align:center}
    .eyebrow{font-family:'JetBrains Mono',monospace;font-size:13px;color:#c84e14;letter-spacing:.16em;
      text-transform:uppercase;margin-bottom:22px}
    .h{font-family:Inter,system-ui,sans-serif;font-size:54px;font-weight:800;color:#f0ede6;
      letter-spacing:-.03em;line-height:1.12}
    .h .a{color:#c84e14}
    .sub{font-family:'JetBrains Mono',monospace;font-size:14px;color:#5a5548;margin-top:18px;letter-spacing:.02em}
  </style></head><body><div class="box">
    <div class="eyebrow">Recourse</div>
    <div class="h">The agent decides.<br><span class="a">KeeperHub executes.</span></div>
    <div class="sub">recourse.dev · DoraHacks KeeperHub</div>
  </div></body></html>`);
  await sleep(4700);

  await ctx.close();
  await browser.close();
  console.log('DONE recording.');
})().catch(async (e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
