// record_v8.cjs — REAL interactive demo recording
// NO page.setContent() — every scene shows the real running app
// Real Playwright clicks, smooth scrolling, real typing, animations play out

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8090';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let recordingStart = 0;
const sceneTimestamps = {};

function markScene(name) {
  const t = (Date.now() - recordingStart) / 1000;
  sceneTimestamps[name] = Math.round(t * 100) / 100;
  console.log(`  [SCENE] ${name} @ ${sceneTimestamps[name]}s`);
  return t;
}

// Smooth scroll using mouse wheel (looks like real user scrolling)
async function smoothScroll(page, deltaY, steps = 8, delayMs = 60) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, deltaY / steps);
    await sleep(delayMs);
  }
}

// Scroll element into view smoothly using native scrollIntoView
async function scrollToElement(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, selector);
}

// Mouse move to element center, then click — looks like real user
async function mouseClickElement(page, selector, { holdMs = 120 } = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    // fallback to locator click
    await page.locator(selector).first().click({ force: true });
    return;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Move mouse to element center with visible movement
  await page.mouse.move(cx, cy, { steps: 12 });
  await sleep(holdMs);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(200);
}

// Type text character by character (real keystrokes)
async function typeIntoField(page, selector, text, { charDelay = 50 } = {}) {
  const el = page.locator(selector).first();
  await el.click({ force: true });
  await sleep(100);
  await el.fill('');
  await sleep(100);
  // Type char by char for visual effect
  for (const ch of text) {
    await el.press(ch === '0' && text.startsWith('0x') ? '0' : ch);
    await sleep(charDelay);
  }
}

(async () => {
  const outDir = path.join(__dirname, 'raw-v8');
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Kill any existing server on 8090
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

  // ═══════════════════════════════════════════════════════════
  // PART A: Landing page
  // ═══════════════════════════════════════════════════════════
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await sleep(1500);

  recordingStart = Date.now();
  console.log('Recording started');

  // Scene 1: Hero — land on it, pause, scroll slightly to reveal badges
  console.log('[1] Hero section');
  markScene('hero_start');
  await sleep(3000);
  // Gentle scroll to reveal badges
  await smoothScroll(page, 200, 6, 80);
  await sleep(3000);
  markScene('hero_end');

  // Scene 2: Scroll to "What It Does" — 3 primitives cards
  console.log('[2] Primitives');
  markScene('primitives_start');
  await scrollToElement(page, '#does');
  await sleep(3500);
  // Scroll a bit more to show all 3 cards
  await smoothScroll(page, 150, 5, 80);
  await sleep(2500);
  markScene('primitives_end');

  // Scene 3: Scroll to "How It Works"
  console.log('[3] How it works');
  markScene('how_start');
  await scrollToElement(page, '#howitworks');
  await sleep(3000);
  await smoothScroll(page, 100, 4, 80);
  await sleep(2000);
  markScene('how_end');

  // ═══════════════════════════════════════════════════════════
  // PART B: Navigate to demo
  // ═══════════════════════════════════════════════════════════
  // Scene 4: Click "Launch Demo" — smooth scroll to hero, click
  console.log('[4] Launch Demo');
  markScene('launch_start');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(800);
  await mouseClickElement(page, 'a.btn-primary[href="demo.html"]');
  await page.waitForLoadState('networkidle');
  await sleep(1000);
  markScene('launch_end');

  // Scene 5: Click "Offline Demo (No Wallet)"
  console.log('[5] Offline Demo');
  markScene('offline_start');
  await mouseClickElement(page, 'button:has-text("Offline Demo")');
  // Wait for workspace to appear (connect-only class removed)
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app && !app.classList.contains('connect-only');
  }, { timeout: 8000 });
  await sleep(2000);
  markScene('offline_end');

  // ═══════════════════════════════════════════════════════════
  // PART C: Workspace interaction
  // ═══════════════════════════════════════════════════════════
  // Scene 6: Workspace visible — pause to let it render, scroll sidebar
  console.log('[6] Workspace');
  markScene('workspace_start');
  await sleep(3000);
  // Scroll within the main content area to show different sections
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 100, behavior: 'smooth' });
  });
  await sleep(2000);
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 250, behavior: 'smooth' });
  });
  await sleep(2000);
  markScene('workspace_end');

  // Scene 7: Fill the escrow creation form — REAL TYPING
  console.log('[7] Fill form');
  markScene('form_start');
  // Scroll to show the form area
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await sleep(1000);

  // Type amount
  const amountInput = page.locator('#inputAmount');
  await amountInput.click();
  await sleep(300);
  await amountInput.fill('');
  await sleep(200);
  // Type "10" char by char
  await page.keyboard.type('1', { delay: 80 });
  await sleep(150);
  await page.keyboard.type('0', { delay: 80 });
  await sleep(500);

  // Type seller address
  const sellerInput = page.locator('#inputSeller');
  await sellerInput.click();
  await sleep(300);
  await sellerInput.fill('');
  await sleep(200);
  await page.keyboard.type('0x000000000000000000000000000000000000BEEF', { delay: 20 });
  await sleep(500);

  // Type task description
  const taskInput = page.locator('#inputTask');
  if (await taskInput.count() > 0) {
    await taskInput.click();
    await sleep(300);
    await taskInput.fill('');
    await sleep(200);
    await page.keyboard.type('test-task-description', { delay: 30 });
  }
  await sleep(1000);
  markScene('form_end');

  // Scene 8: Click "Approve USDC & Create Escrow"
  console.log('[8] Create Escrow');
  markScene('create_start');
  await mouseClickElement(page, '#createBtn');
  // Wait for escrow to appear in the list (status chip)
  await sleep(3000);
  // Wait for any status change or log entry
  await page.waitForFunction(() => {
    const log = document.getElementById('log');
    return log && log.textContent.length > 20;
  }, { timeout: 5000 }).catch(() => {});
  await sleep(2000);
  markScene('create_end');

  // Scene 9: Raise Dispute — real click
  console.log('[9] Raise Dispute');
  markScene('dispute_start');
  // Scroll to show dispute button area
  await page.evaluate(() => {
    const btn = document.getElementById('disputeBtn');
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await sleep(1000);
  await mouseClickElement(page, '#disputeBtn');
  // Let dispute UI play out — badge changes to Disputed, pipeline appears
  await sleep(4000);
  markScene('dispute_end');

  // Scene 10: Pipeline — watch phases 1 and 2 advance
  console.log('[10] Pipeline');
  markScene('pipeline_start');
  // Scroll to show pipeline panel
  await page.evaluate(() => {
    const pp = document.getElementById('pipelinePanel');
    if (pp) pp.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  await sleep(5000);
  markScene('pipeline_end');

  // ═══════════════════════════════════════════════════════════
  // PART D: Execution simulation — THE CENTERPIECE
  // ═══════════════════════════════════════════════════════════
  // Scene 11: Click "Buyer Wins (Refund)" → execution sim launches
  console.log('[11] Execution Sim');
  markScene('execsim_start');
  // Scroll to find the resolution buttons
  await page.evaluate(() => {
    // Find "Buyer Wins" button — check onclick attribute for buyerWins=true
    const btns = document.querySelectorAll('button[onclick*="launchExecutionSim"]');
    for (const b of btns) {
      if (b.textContent.includes('Buyer Wins')) {
        b.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  });
  await sleep(800);
  await mouseClickElement(page, 'button:has-text("Buyer Wins")');

  // Let the 4-phase execution sim play out naturally
  // Phase 1: evidence hashing (~2.4s for 4 items at 600ms)
  await sleep(3500);
  // Phase 2: AI arbiter typewriter (~3-4s for reasoning text at 25ms/char)
  await sleep(5000);
  // Phase 3: policy agent checks (~1.5s for 3 items at 500ms)
  await sleep(3000);
  // Phase 4: broadcast + confirm (~2s for 4 items at 500ms + confirmation)
  await sleep(4000);
  markScene('execsim_end');

  // Scene 12: Aftermath — scroll to see keystrokes panel, result summary, audit trail
  console.log('[12] Aftermath');
  markScene('aftermath_start');
  // Scroll down to see the result summary + keystrokes
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
  });
  await sleep(4000);
  // Scroll a bit more to show audit trail
  await page.evaluate(() => {
    const audit = document.getElementById('auditTrail');
    if (audit) audit.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await sleep(3000);
  markScene('aftermath_end');

  // Scene 13: Scroll back to top — final view of complete workspace
  console.log('[13] Final view');
  markScene('final_start');
  await page.evaluate(() => {
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await sleep(3000);
  markScene('final_end');

  // ═══════════════ Finalize ═══════════════
  const totalDuration = (Date.now() - recordingStart) / 1000;
  console.log(`\nRecording complete. Total: ${totalDuration.toFixed(1)}s`);

  const tsPath = path.join(__dirname, 'v8_timestamps.json');
  fs.writeFileSync(tsPath, JSON.stringify({ totalDuration, scenes: sceneTimestamps }, null, 2));
  console.log('Timestamps written to:', tsPath);

  await ctx.close();
  await browser.close();
  console.log('Browser closed. Output:', outDir);
})().catch(async (e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
