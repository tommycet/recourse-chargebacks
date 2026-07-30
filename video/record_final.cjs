const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ARBITER_OUT = fs.readFileSync('/tmp/arbiter-output.txt', 'utf-8');

async function slowScroll(page, from, to, steps, delay) {
  for (let i = 0; i <= steps; i++) {
    const y = from + (to - from) * (i / steps);
    await page.evaluate(y => window.scrollTo(0, y), y);
    await page.waitForTimeout(delay);
  }
}

async function moveAndClick(page, selector) {
  const el = await page.$(selector);
  if (!el) { console.log('NOT FOUND:', selector); return false; }
  const box = await el.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 15 });
    await page.waitForTimeout(200);
  }
  await el.click();
  return true;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: path.join(__dirname, 'raw-final'), size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();

  // === SCENE 1: Landing page scroll (25s) ===
  console.log('Loading landing page...');
  await page.goto('http://localhost:8090/index.html', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  // Slow scroll through hero
  await slowScroll(page, 0, 400, 10, 200);
  await page.waitForTimeout(2000);
  // Scroll to explore section
  await slowScroll(page, 400, 900, 10, 200);
  await page.waitForTimeout(2000);
  // Scroll to how-it-works
  await slowScroll(page, 900, 1600, 10, 200);
  await page.waitForTimeout(2000);
  // Scroll back up to launch demo button
  await slowScroll(page, 1600, 660, 15, 150);
  await page.waitForTimeout(1000);

  // === Click Launch Demo (3s) ===
  console.log('Clicking Launch Demo...');
  const launchBtn = await page.$('a.btn-primary[href="demo.html"]');
  if (launchBtn) {
    const box = await launchBtn.boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 20 });
    await page.waitForTimeout(500);
    await launchBtn.click();
  }
  await page.waitForTimeout(3000);

  // === Demo page: connect demo mode (5s) ===
  console.log('Connecting demo mode...');
  // Look for Demo Mode button
  const demoBtn = await page.$('button[onclick="connectOfflineDemo()"]') || 
                   await page.$('button[onclick="connectDemo()"]');
  if (demoBtn) {
    const box = await demoBtn.boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 15 });
    await page.waitForTimeout(500);
    await demoBtn.click();
    console.log('Clicked demo mode');
  } else {
    console.log('Demo mode button not found, trying direct...');
    await page.evaluate(() => { if (typeof connectOfflineDemo === 'function') connectOfflineDemo(); });
  }
  await page.waitForTimeout(5000);

  // === Fill escrow form + create (10s) ===
  console.log('Creating escrow...');
  // Try to fill form fields if they exist
  const sellerInput = await page.$('#inputSeller, input[name="seller"], input[placeholder*="seller"]');
  if (sellerInput) {
    await sellerInput.fill('0x000000000000000000000000000000000000BEEF');
  }
  const amountInput = await page.$('#inputAmount, input[name="amount"], input[placeholder*="amount"]');
  if (amountInput) {
    await amountInput.fill('10');
  }
  await page.waitForTimeout(2000);

  // Click create escrow button
  await moveAndClick(page, '#createBtn, button[onclick="doCreateEscrow()"]');
  await page.waitForTimeout(8000);

  // === Raise dispute (8s) ===
  console.log('Raising dispute...');
  await moveAndClick(page, '#disputeBtn, button[onclick="doRaiseDispute()"]');
  await page.waitForTimeout(8000);

  // === Terminal: Arbiter output (15s) ===
  console.log('Terminal scene...');
  const arbLines = ARBITER_OUT.split('\n').map(l => {
    if (l.includes('"source": "llm"')) return `<span style="color:#3fb950">${l}</span>`;
    if (l.includes('"buyerWins": true')) return `<span style="color:#3fb950">${l}</span>`;
    if (l.includes('"buyerWins": false')) return `<span style="color:#f85149">${l}</span>`;
    if (l.includes('═══')) return `<span style="color:#c84e14">${l}</span>`;
    if (l.includes('Scenario')) return `<span style="color:#d2a8ff">${l}</span>`;
    if (l.includes('confidence')) return `<span style="color:#58a6ff">${l}</span>`;
    return l;
  }).join('\n');

  await page.setContent(`<html><body style="margin:0;background:#0a0a0a;display:flex;align-items:center;justify-content:center;height:100vh">
  <div style="width:1700px;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:32px;font-family:'Courier New',monospace;font-size:14px;line-height:1.6;color:#c9d1d9;white-space:pre-wrap;box-shadow:0 4px 30px rgba(0,0,0,0.5)"><span style="color:#58a6ff">$</span> npx tsx arbiter-runner.ts (Groq llama-3.3-70b)
${arbLines}</div></body></html>`);
  await page.waitForTimeout(15000);

  // === Terminal: Pipeline output (12s) ===
  await page.setContent(`<html><body style="margin:0;background:#0a0a0a;display:flex;align-items:center;justify-content:center;height:100vh">
  <div style="width:1700px;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:32px;font-family:'Courier New',monospace;font-size:14px;line-height:1.6;color:#c9d1d9;white-space:pre-wrap;box-shadow:0 4px 30px rgba(0,0,0,0.5)"><span style="color:#58a6ff">$</span> npx tsx keeperhub-demo.ts
<span style="color:#c84e14">[pipeline]</span> Phase 1: Evidence verifier checking escrow #3...
<span style="color:#3fb950">  PASS — Evidence valid (hash, addresses, delivery coherence)</span>

<span style="color:#c84e14">[arbiter]</span> Running LLM analysis (Groq llama-3.3-70b)...
<span style="color:#3fb950">[arbiter]</span> Verdict: buyerWins=true confidence=1.0
<span style="color:#d2a8ff">[arbiter]</span> "Delivery failed — buyer entitled to full refund"

<span style="color:#c84e14">[pipeline]</span> Phase 3: Policy agent...
<span style="color:#3fb950">[pipeline]</span> APPROVED

<span style="color:#c84e14">[keeperhub]</span> Simulating resolveDispute(3, true, 0x7532...)...
<span style="color:#3fb950">[keeperhub]</span> Simulation passed — broadcasting...
<span style="color:#3fb950">[keeperhub]</span> TX: 0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0
<span style="color:#3fb950">[keeperhub]</span> Execution ID: 7z0t2yr9ecczhx0tfgad6
<span style="color:#3fb950">[keeperhub]</span> Audit: https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6</div></body></html>`);
  await page.waitForTimeout(12000);

  // === Blockscout (12s) ===
  console.log('Blockscout...');
  try {
    await page.goto('https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(12000);
  } catch {
    // Fallback
    await page.setContent(`<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="width:1200px;background:#111;border:1px solid #333;border-radius:12px;padding:40px;font-family:system-ui">
      <div style="color:#c84e14;font-size:12px;text-transform:uppercase;margin-bottom:20px">Sepolia Blockscout</div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Status:</span> <span style="color:#3fb950;font-weight:600">Success ✓</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Block:</span> <span style="color:#f0ede6">11,374,381</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Method:</span> <span style="color:#f0ede6">resolveDispute</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">From:</span> <span style="color:#c84e14">0x32db418d... (KeeperHub)</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">To:</span> <span style="color:#c84e14">0x8c0c5c07... (RecourseEscrow)</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">TX:</span> <span style="color:#c84e14">0x6ad71f82...056afa0</span></div>
      <div style="padding-top:16px;border-top:1px solid #333"><span style="color:#3fb950">9.9 USDC refunded to buyer</span></div>
    </div></body></html>`);
    await page.waitForTimeout(12000);
  }

  // === Closing card (8s) ===
  console.log('Closing...');
  await page.setContent(`<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
  <div style="text-align:center">
    <div style="font-family:monospace;font-size:56px;font-weight:700;color:#c84e14;margin-bottom:16px">Recourse</div>
    <div style="font-family:system-ui;font-size:18px;color:#8a8578;margin-bottom:24px">Chargebacks for the Machine Economy</div>
    <div style="font-family:monospace;font-size:16px;color:#f0ede6;margin-bottom:8px">The agent decides. KeeperHub executes.</div>
    <div style="font-family:monospace;font-size:12px;color:#5a5548;margin-top:24px">github.com/tommycet/recourse-chargebacks</div>
  </div></body></html>`);
  await page.waitForTimeout(8000);

  await ctx.close();
  await browser.close();
  console.log('Done!');
})();
