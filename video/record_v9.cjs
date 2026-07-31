// record_v9.cjs — Recourse demo: thorough, human-like, 120s
// Real clicks, smooth scrolling, real typing, animations play out fully
// NO page.setContent()

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8090';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let recordingStart = 0;
const scenes = {};

function mark(name) {
  const t = (Date.now() - recordingStart) / 1000;
  scenes[name] = Math.round(t * 100) / 100;
  console.log(`  [${name}] @ ${scenes[name]}s`);
  return t;
}

// Mouse movement + click — visible cursor movement
async function clickEl(page, selector) {
  const el = page.locator(selector).first();
  const box = await el.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
    await sleep(150);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
    await sleep(300);
  } else {
    await el.click({ force: true });
    await sleep(300);
  }
}

// Smooth scroll to element
async function scrollTo(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, selector);
}

// Natural scroll down with mouse wheel
async function wheelDown(page, px = 300, steps = 6, delay = 70) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await sleep(delay);
  }
}

(async () => {
  const outDir = path.join(__dirname, 'raw-v9');
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

  // ═══════════════ PART A: Landing Page ═══════════════
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await sleep(1500);

  recordingStart = Date.now();
  console.log('Recording started');

  // Scene 1: Hero — 12s (narration explains the problem: x402 has no chargebacks)
  console.log('Scene 1: Hero');
  mark('hero_start');
  await sleep(4000); // let hero render, viewer reads headline
  await wheelDown(page, 250, 5, 80); // reveal badges slowly
  await sleep(4000);
  await wheelDown(page, 200, 4, 80); // show CTA buttons
  await sleep(3000);
  mark('hero_end');

  // Scene 2: Primitives — 10s (narration: three primitives that make it work)
  console.log('Scene 2: Primitives');
  mark('primitives_start');
  await scrollTo(page, '#does');
  await sleep(4000);
  await wheelDown(page, 150, 4, 80); // pan through all 3 cards
  await sleep(4000);
  await wheelDown(page, 100, 3, 80);
  await sleep(2500);
  mark('primitives_end');

  // Scene 3: How It Works — 10s (narration: the flow)
  console.log('Scene 3: How It Works');
  mark('how_start');
  await scrollTo(page, '#howitworks');
  await sleep(4000);
  await wheelDown(page, 150, 4, 80);
  await sleep(4000);
  await wheelDown(page, 100, 3, 80);
  await sleep(2500);
  mark('how_end');

  // ═══════════════ PART B: Launch Demo ═══════════════
  // Scene 4: Click Launch Demo — 6s (narration: let us see this in action)
  console.log('Scene 4: Launch Demo');
  mark('launch_start');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(1500);
  await clickEl(page, 'a.btn-primary[href="demo.html"]');
  await page.waitForLoadState('networkidle');
  await sleep(2000);
  mark('launch_end');

  // Scene 5: Click Offline Demo — 4s
  console.log('Scene 5: Offline Demo');
  mark('offline_start');
  await clickEl(page, 'button:has-text("Offline Demo")');
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app && !app.classList.contains('connect-only');
  }, { timeout: 8000 });
  await sleep(2500);
  mark('offline_end');

  // ═══════════════ PART C: Workspace + Demo ═══════════════
  // Scene 6: Workspace reveal — 14s (narration: this is the dashboard, pipeline, etc)
  console.log('Scene 6: Workspace');
  mark('workspace_start');
  await sleep(3000);
  // Pan through the workspace — show sidebar, main area, pipeline panel
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 80, behavior: 'smooth' });
  });
  await sleep(4000);
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 200, behavior: 'smooth' });
  });
  await sleep(3500);
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 350, behavior: 'smooth' });
  });
  await sleep(3000);
  mark('workspace_end');

  // Scene 7: Fill form + Create Escrow — 14s (narration: creating escrow, locking USDC)
  console.log('Scene 7: Fill Form + Create');
  mark('form_start');
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await sleep(1000);

  // Type amount — real keystrokes
  const amountInput = page.locator('#inputAmount');
  await amountInput.click();
  await sleep(300);
  await amountInput.fill('');
  await sleep(200);
  await page.keyboard.type('10', { delay: 80 });
  await sleep(500);

  // Type seller address
  const sellerInput = page.locator('#inputSeller');
  await sellerInput.click();
  await sleep(300);
  await sellerInput.fill('');
  await sleep(200);
  await page.keyboard.type('0x000000000000000000000000000000000000BEEF', { delay: 15 });
  await sleep(500);

  // Type task
  const taskInput = page.locator('#inputTask');
  if (await taskInput.count() > 0) {
    await taskInput.click();
    await sleep(200);
    await taskInput.fill('');
    await sleep(200);
    await page.keyboard.type('test-task-description', { delay: 25 });
  }
  await sleep(800);

  // Click Create Escrow
  await clickEl(page, '#createBtn');
  // Wait for escrow to appear
  await sleep(5000);
  await page.waitForFunction(() => {
    const log = document.getElementById('log');
    return log && log.textContent.includes('created');
  }, { timeout: 8000 }).catch(() => {});
  await sleep(2000);
  mark('form_end');

  // Scene 8: Raise Dispute — 10s (narration: dispute raised, pipeline activates)
  console.log('Scene 8: Raise Dispute');
  mark('dispute_start');
  await page.evaluate(() => {
    const btn = document.getElementById('disputeBtn');
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await sleep(1500);
  await clickEl(page, '#disputeBtn');
  // Let dispute play — badge changes, pipeline phase 1 activates
  await sleep(8500);
  mark('dispute_end');

  // Scene 9: Execution Sim — 18s (narration: 4-phase sim, deep explanation)
  console.log('Scene 9: Execution Sim');
  mark('execsim_start');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button[onclick*="launchExecutionSim"]');
    for (const b of btns) {
      if (b.textContent.includes('Buyer Wins')) {
        b.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  });
  await sleep(1000);
  await clickEl(page, 'button:has-text("Buyer Wins")');

  // Let the 4-phase execution sim play out FULLY — this IS the demo
  // Phase 1: hash verification (~2.4s)
  await sleep(3500);
  // Phase 2: AI arbiter typewriter (~4-5s)
  await sleep(6000);
  // Phase 3: policy checks (~1.5s)
  await sleep(3000);
  // Phase 4: broadcast + confirm (~2s)
  await sleep(4000);
  // Buffer for completion animations
  await sleep(2500);
  mark('execsim_end');

  // Scene 10: Aftermath — 14s (narration: audit trail, keystrokes, result)
  console.log('Scene 10: Aftermath');
  mark('aftermath_start');
  // Scroll to show keystrokes + result summary
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
  });
  await sleep(5000);
  // Show audit trail
  await page.evaluate(() => {
    const audit = document.getElementById('auditTrail');
    if (audit) audit.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await sleep(5000);
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollBy({ top: 200, behavior: 'smooth' });
  });
  await sleep(4000);
  mark('aftermath_end');

  // Scene 11: Closing — 8s (narration: closing line)
  console.log('Scene 11: Closing');
  mark('closing_start');
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await sleep(8000);
  mark('closing_end');

  // ═══════════════ Finalize ═══════════════
  const totalDuration = (Date.now() - recordingStart) / 1000;
  console.log(`\nRecording complete. Total: ${totalDuration.toFixed(1)}s`);

  fs.writeFileSync(path.join(__dirname, 'v9_timestamps.json'),
    JSON.stringify({ totalDuration, scenes }, null, 2));

  await page.close();
  await sleep(1000);
  await ctx.close();
  await browser.close();
  console.log('Browser closed. Output:', outDir);
})().catch(async (e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
