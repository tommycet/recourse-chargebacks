// record_v4.cjs — Single continuous Playwright recording for Recourse demo v4
// Records one WebM with all scenes, then assembles with TTS narration audio.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = 8090;
const BASE = `http://localhost:${PORT}`;
const OUTDIR = path.join(__dirname, 'raw-v4');

// Arbiter terminal output (real, from GROQ LLM)
const ARBITER_OUTPUT = `═══════════════════════════════════════════
  Recourse Arbiter Runner — Dispute Simulation
═══════════════════════════════════════════

Scenario 1: Non-delivery (deliveryStatus=failed)
  Task: ai-image-generation-service
  Amount: 10 USDC
  Running arbiter...

  Verdict: {
  "buyerWins": true,
  "confidence": 1,
  "reasoning": "deliveryStatus is 'failed', matching rule...",
  "source": "llm"
}

Scenario 2: Delivered correctly (deliveryStatus=delivered)
  Task: ai-text-summarization
  Amount: 5 USDC
  Running arbiter...

  Verdict: {
  "buyerWins": false,
  "confidence": 0.9,
  "reasoning": "Delivery status is 'delivered'...",
  "source": "llm"
}

═══════════════════════════════════════════
  SIMULATION SUMMARY
═══════════════════════════════════════════
  Scenario 1 (non-delivery): buyerWins=true confidence=1
  Scenario 2 (delivered):    buyerWins=false confidence=0.9
═══════════════════════════════════════════`;

// Custom terminal HTML page for typing out arbiter output
const TERMINAL_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;font-family:'JetBrains Mono','SF Mono','Fira Code',monospace;color:#e0e0e0;overflow:hidden}
.terminal{width:100vw;height:100vh;padding:20px;overflow:hidden}
.title-bar{background:#1a1a1a;padding:8px 16px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:8px;margin:-20px -20px 0 -20px;border-bottom:1px solid #333}
.dot-r,.dot-y,.dot-g{width:12px;height:12px;border-radius:50%}.dot-r{background:#ff5f57}.dot-y{background:#febc2e}.dot-g{background:#28c840}
.title-bar span{margin-left:12px;font-size:12px;color:#888}
.code{white-space:pre-wrap;font-size:13px;line-height:1.6}
.cursor{display:inline-block;width:8px;height:15px;background:#e0e0e0;animation:b 1s step-end infinite;vertical-align:text-bottom}
@keyframes b{50%{opacity:0}}
</style></head><body>
<div class="terminal">
<div class="title-bar"><div class="dot-r"></div><div class="dot-y"></div><div class="dot-g"></div>
<span>agent/arbiter-runner.ts — Groq LLM (llama-3.3-70b-versatile)</span></div>
<div style="padding-top:12px"><div class="code" id="code"></div><span class="cursor" id="cursor"></span></div>
</div>
<script>
const output = ${JSON.stringify(ARBITER_OUTPUT)};
const el = document.getElementById('code');
let i = 0;
function typeChar(){
  if(i<output.length){el.textContent+=output[i];i++;
  window.scrollTo(0,document.body.scrollHeight);
  setTimeout(typeChar,output[i-1]==='\\\\n'?40:12);}}
typeChar();
</script></body></html>`;

// Terminal transaction log page
const TXLOG_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;font-family:'JetBrains Mono',monospace;color:#e0e0e0;padding:24px}
h1{font-size:15px;color:#c84e14;margin-bottom:20px;font-weight:600}
.e{padding:10px 14px;border-left:3px solid #333;margin-bottom:6px;font-size:12px;line-height:1.5}
.e.i{border-color:#4a7ec8}.e.ok{border-color:#4a9e5c}.e.w{border-color:#c84e14}
.ts{color:#555;font-size:11px;margin-right:8px}
</style></head><body>
<div id="c"></div>
<script>
const E=[
{t:'07:30:12',c:'i',m:'Phase 1: Computing evidence bundle hash...'},
{t:'07:30:14',c:'ok',m:'Phase 1: keccak256(request) → 0x1a49b78e ✓'},
{t:'07:30:14',c:'ok',m:'Phase 1: keccak256(response) → 0x2938e672 ✓'},
{t:'07:30:15',c:'ok',m:'Phase 1: Evidence verified — keccak256 integrity confirmed ✓'},
{t:'07:30:16',c:'i',m:'Phase 2: AI arbiter analyzing evidence...'},
{t:'07:30:18',c:'ok',m:'AI Arbiter verdict: Buyer Wins (Refund) — confidence: 1.0'},
{t:'07:30:19',c:'ok',m:'Policy agent: all checks passed ✓'},
{t:'07:30:20',c:'i',m:'Phase 4: KeeperHub broadcasting transaction...'},
{t:'07:30:21',c:'ok',m:'MEV protection: private routing active'},
{t:'07:30:22',c:'ok',m:'Phase 4: Broadcasted to Sepolia network'},
{t:'07:30:24',c:'ok',m:'Mining in block 11,374,381...'},
{t:'07:30:26',c:'ok',m:'TX Confirmed: 0x6ad71f82...056afa0'},
{t:'07:30:26',c:'ok',m:'Gas used: 52,341 (smart gas estimation)'},
];
const c=document.getElementById('c');
c.innerHTML='<h1>⚡ KeeperHub Execution Log — Real Sepolia</h1>';
let i=0;
function add(){
  if(i>=E.length)return;
  const e=E[i];
  const d=document.createElement('div');d.className='e '+e.c;
  d.innerHTML='<span class="ts">'+e.t+'</span>'+e.m;
  c.appendChild(d);
  window.scrollTo(0,document.body.scrollHeight);
  i++;setTimeout(add,300+Math.random()*200);
}
add();
</script></body></html>`;

// Slow scroll helper
async function slowScroll(page, targetY, duration) {
  const startY = await page.evaluate(() => window.scrollY);
  const diff = targetY - startY;
  const steps = Math.max(20, Math.round(duration / 30));
  for (let i = 0; i <= steps; i++) {
    const y = startY + (diff * i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(Math.round(duration / steps));
  }
}

// Smooth mouse move to (x,y)
async function moveMouse(page, x, y) {
  await page.mouse.move(x, y, { steps: 12 });
  await page.waitForTimeout(200);
}

// Click element by text content
async function clickText(page, text) {
  const btns = await page.$$('a, button');
  for (const b of btns) {
    const t = await b.textContent();
    if (t && t.includes(text)) {
      const box = await b.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 10 });
        await page.waitForTimeout(400);
        await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
        return true;
      }
    }
  }
  return false;
}

// Inject cursor overlay
const CURSOR_JS = `
  const o = document.createElement('div');
  o.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:99999';
  const d = document.createElement('div');
  d.style.cssText='position:absolute;width:20px;height:20px;border-radius:50%;border:2px solid #c84e14;background:rgba(200,78,20,0.3);transform:translate(-50%,-50%);pointer-events:none';
  o.appendChild(d);document.body.appendChild(o);
  document.addEventListener('mousemove',e=>{d.style.left=e.clientX+'px';d.style.top=e.clientY+'px';});
`;

(async () => {
  // Clean up
  if (fs.existsSync(OUTDIR)) fs.rmSync(OUTDIR, { recursive: true });
  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: OUTDIR,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();
  const startTime = Date.now();

  // ═══════════════════════════════════════════════════════════════
  // SCENE 1-3: Landing page (41s) — clips 01-03
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 1-3: Landing page ===');
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.evaluate(CURSOR_JS);

  // Scene 1 (clip01 ~16s): Hero — scroll slowly
  console.log('  Hero section (16s)...');
  await page.waitForTimeout(3000);
  await slowScroll(page, 500, 4000);
  await page.waitForTimeout(500);
  await slowScroll(page, 1200, 4000);
  await page.waitForTimeout(4500);

  // Scene 2 (clip02 ~12s): How It Works
  console.log('  How It Works (12s)...');
  const hwOffset = await page.evaluate(() => {
    const el = document.getElementById('howitworks');
    return el ? el.offsetTop - 80 : 600;
  });
  await slowScroll(page, hwOffset, 3000);
  await page.waitForTimeout(2000);
  await slowScroll(page, hwOffset + 300, 2500);
  await page.waitForTimeout(3000);
  await slowScroll(page, hwOffset + 600, 2500);
  await page.waitForTimeout(2000);

  // Scene 3 (clip03 ~14s): Live Proof
  console.log('  Live Proof (14s)...');
  const proofOffset = await page.evaluate(() => {
    const el = document.getElementById('proof');
    return el ? el.offsetTop - 80 : 2000;
  });
  await slowScroll(page, proofOffset, 3000);
  await page.waitForTimeout(2000);
  await slowScroll(page, proofOffset + 200, 2500);
  await page.waitForTimeout(2500);
  await slowScroll(page, proofOffset + 400, 2000);
  await page.waitForTimeout(2500);
  await slowScroll(page, proofOffset + 100, 1500);
  await page.waitForTimeout(1500);

  // ═══════════════════════════════════════════════════════════════
  // SCENE 4-5: Click Launch Demo → Demo connect (clip04+05 ~16s)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 4-5: Launch Demo ===');
  
  // Scene 4 (clip04 ~11s): Scroll back to top, find Launch Demo
  console.log('  Back to hero + find button (11s)...');
  await slowScroll(page, 0, 3000);
  await page.waitForTimeout(2000);
  
  // Hover over Launch Demo
  const launchBtn = await page.$('a.btn-primary[href="demo.html"]');
  if (launchBtn) {
    const box = await launchBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 12 });
      await page.waitForTimeout(3000);
      // Click it
      await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
      await page.waitForTimeout(3000);
    }
  }
  
  // Scene 5 (clip05 ~5s + clip06 start): Now on demo.html connect screen
  console.log('  Demo connect screen (5s)...');
  await page.waitForTimeout(1000);
  await page.evaluate(CURSOR_JS);
  
  // Hover over Offline Demo button
  const offlineBtn = await page.$('button.btn-ghost');
  if (offlineBtn) {
    const box = await offlineBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 10 });
    }
  }
  await page.waitForTimeout(2000);
  
  // ═══════════════════════════════════════════════════════════════
  // SCENE 6: Connect + Create Escrow (clip06 ~11s)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 6: Connect + Create Escrow ===');
  
  // Click Offline Demo
  if (offlineBtn) {
    const box = await offlineBtn.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    }
  }
  await page.waitForTimeout(3000);
  
  // Show sidebar, wallet connected
  console.log('  Connected, showing workspace...');
  await page.waitForTimeout(1500);
  
  // Move mouse over to sidebar to show contract info
  await moveMouse(page, 130, 200);
  await page.waitForTimeout(1000);
  
  // Now create escrow
  console.log('  Creating escrow...');
  // Fill seller address
  try {
    const sellerInput = await page.$('#inputSeller');
    if (sellerInput) {
      await sellerInput.click();
      await page.evaluate(() => {
        document.getElementById('inputSeller').value = '0x1234567890abcdef1234567890abcdef12345678';
      });
    }
  } catch {}
  await page.waitForTimeout(1000);
  
  // Move to Create button
  const createBtn = await page.$('button:has-text("Approve USDC")');
  if (createBtn) {
    const box = await createBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 10 });
      await page.waitForTimeout(500);
      await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    }
  }
  await page.waitForTimeout(4000);
  
  // ═══════════════════════════════════════════════════════════════
  // SCENE 7: Raise Dispute (clip07 ~12s)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 7: Raise Dispute ===');
  await page.waitForTimeout(2000);
  
  // Click Raise Dispute button
  console.log('  Raising dispute...');
  const disputeBtn = await page.$('button:has-text("Raise Dispute")');
  if (disputeBtn) {
    const box = await disputeBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 10 });
      await page.waitForTimeout(500);
      await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    }
  }
  await page.waitForTimeout(2000);
  
  // Scroll to show pipeline
  console.log('  Showing pipeline animation...');
  await page.evaluate(() => {
    const pp = document.getElementById('pipelinePanel');
    if (pp) pp.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  await page.waitForTimeout(4000);
  
  // Move mouse to show the pipeline phases
  await moveMouse(page, 400, 300);
  await page.waitForTimeout(1500);
  await moveMouse(page, 800, 300);
  await page.waitForTimeout(1500);
  
  // ═══════════════════════════════════════════════════════════════
  // SCENE 8: Resolve Dispute (clip08 ~9s)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 8: Resolve Dispute ===');
  
  // Scroll to action panel
  await page.evaluate(() => {
    const ap = document.getElementById('actionPanel');
    if (ap) ap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  await page.waitForTimeout(1500);
  
  // Click "✓ Buyer Wins (Refund)"
  console.log('  Resolving dispute...');
  const resolveBtn = await page.$('button:has-text("Buyer Wins")');
  if (resolveBtn) {
    const box = await resolveBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 10 });
      await page.waitForTimeout(500);
      await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    }
  }
  await page.waitForTimeout(4000);
  
  // Scroll to show execution simulator
  console.log('  Showing execution simulator...');
  await page.evaluate(() => {
    const es = document.getElementById('execSimulator');
    if (es) es.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  await page.waitForTimeout(5000);

  // ═══════════════════════════════════════════════════════════════
  // SCENE 9: Terminal — Arbiter Runner (clip09a ~7s)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 9: Terminal Arbiter ===');
  await page.setContent(TERMINAL_HTML, { waitUntil: 'networkidle' });
  await page.waitForTimeout(7000);

  // ═══════════════════════════════════════════════════════════════
  // SCENE 10: KeeperHub audit trail (clip10 ~10s)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 10: KeeperHub Audit ===');
  // Navigate back to demo, re-resolve to show audit
  await page.goto(`${BASE}/demo.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await page.evaluate(CURSOR_JS);
  
  // Quick connect + create + dispute + resolve
  await clickText(page, 'Offline Demo');
  await page.waitForTimeout(2500);
  await clickText(page, 'Approve USDC');
  await page.waitForTimeout(3500);
  await clickText(page, 'Raise Dispute');
  await page.waitForTimeout(3000);
  await clickText(page, 'Buyer Wins');
  await page.waitForTimeout(4000);
  
  // Scroll to show audit trail
  console.log('  Showing audit trail...');
  await page.evaluate(() => {
    const at = document.getElementById('auditTrail');
    if (at) { at.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  await page.waitForTimeout(6000);

  // ═══════════════════════════════════════════════════════════════
  // SCENE 11: Transaction log terminal (clip11a ~7s)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 11: TX Log Terminal ===');
  await page.setContent(TXLOG_HTML, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  // ═══════════════════════════════════════════════════════════════
  // SCENE 12: Blockscout (clip13 ~8s)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== SCENE 12: Blockscout ===');
  try {
    await page.goto('https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0', {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    await page.waitForTimeout(2000);
    console.log('  Blockscout loaded, scrolling...');
    await slowScroll(page, 300, 2000);
    await page.waitForTimeout(2000);
    await slowScroll(page, 600, 2000);
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log(`  Blockscout timeout, showing fallback page`);
    await page.goto(`${BASE}/demo.html`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.evaluate(CURSOR_JS);
    await page.waitForTimeout(8000);
  }
  
  // Done!
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nRecording complete. Total duration: ${elapsed.toFixed(1)}s`);
  
  await context.close();
  await browser.close();
  
  // Find the recorded video file
  const files = fs.readdirSync(OUTDIR).filter(f => f.endsWith('.webm'));
  console.log('Recorded WebM files:', files);
})();
