// record-v3.cjs — Playwright recording for Recourse demo video v3
// Records 9 scenes at 1920x1080, outputs raw WebM

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: path.join(__dirname, 'raw-v3'),
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  // === Scene 1: Title card (4s) ===
  console.log('Scene 1: Title card...');
  await page.setContent(`<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="text-align:center">
      <div style="font-family:monospace;font-size:14px;color:#c84e14;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:24px">DoraHacks · KeeperHub Agents Onchain</div>
      <div style="font-family:system-ui,-apple-system,sans-serif;font-size:48px;font-weight:800;color:#f0ede6;letter-spacing:-0.03em;line-height:1.1;margin-bottom:16px">Chargebacks for<br>the <span style="color:#c84e14">Machine Economy</span></div>
      <div style="font-family:monospace;font-size:13px;color:#5a5548">recourse.dev</div>
    </div>
  </body></html>`);
  await page.waitForTimeout(4000);

  // === Scenes 2-4: Landing page scroll (30s total) ===
  console.log('Scene 2-4: Landing page scroll...');
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);

  // Scroll to Hero
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(10000);  // Scene 2 (narration ~9s)

  // Scroll to "How It Works"
  try {
    await page.evaluate(() => {
      const el = document.getElementById('howitworks') || document.querySelector('[id*="how"]');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      else window.scrollTo(0, 600);
    });
  } catch { await page.evaluate(() => window.scrollTo(0, 600)); }
  await page.waitForTimeout(12000);  // Scene 3 (narration ~12s)

  // Scroll to "Live Proof"
  try {
    await page.evaluate(() => {
      const el = document.getElementById('proof') || document.querySelector('[id*="proof"]');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      else window.scrollTo(0, 1200);
    });
  } catch { await page.evaluate(() => window.scrollTo(0, 1200)); }
  await page.waitForTimeout(13000);  // Scene 4 (narration ~13s)

  // === Scene 5: Terminal — Arbiter Runner (15s) ===
  console.log('Scene 5: Arbiter runner terminal...');
  const arbiterText = fs.readFileSync('/tmp/arbiter-output.txt', 'utf-8');
  await page.setContent(`<html><body style="margin:0;background:#0a0a0a;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="width:1600px;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:32px;font-family:'Courier New',monospace;font-size:15px;line-height:1.7;color:#c9d1d9;white-space:pre-wrap;box-shadow:0 4px 30px rgba(0,0,0,0.5)"><span style="color:#58a6ff">$</span> npx tsx arbiter-runner.ts\n\n${arbiterText.split('\n').map(l => {
    if (l.includes('"source": "llm"')) return `<span style="color:#3fb950">${l}</span>`;
    if (l.includes('"buyerWins": true')) return `<span style="color:#3fb950">${l}</span>`;
    if (l.includes('"buyerWins": false')) return `<span style="color:#f85149">${l}</span>`;
    if (l.includes('═══')) return `<span style="color:#c84e14">${l}</span>`;
    if (l.includes('Scenario')) return `<span style="color:#d2a8ff">${l}</span>`;
    return l;
  }).join('\n')}</div>
  </body></html>`);
  await page.waitForTimeout(15000);

  // === Scene 6: Terminal — KeeperHub Pipeline (15s) ===
  console.log('Scene 6: KeeperHub pipeline terminal...');
  await page.setContent(`<html><body style="margin:0;background:#0a0a0a;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="width:1600px;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:32px;font-family:'Courier New',monospace;font-size:15px;line-height:1.7;color:#c9d1d9;white-space:pre-wrap;box-shadow:0 4px 30px rgba(0,0,0,0.5)"><span style="color:#58a6ff">$</span> npx tsx keeperhub-demo.ts\n\n<span style="color:#c84e14">[pipeline]</span> Phase 1: Evidence verifier checking escrow #3...
<span style="color:#3fb950">  ✓ hash format: valid</span>
<span style="color:#3fb950">  ✓ address format: valid</span>
<span style="color:#3fb950">  ✓ delivery coherence: failed delivery consistent with empty response</span>
<span style="color:#3fb950">  ✓ buyer/seller distinctness: addresses differ</span>

<span style="color:#c84e14">[arbiter]</span> Running LLM analysis for escrow #3... <span style="color:#58a6ff">(Groq llama-3.3-70b)</span>
<span style="color:#3fb950">[arbiter]</span> Verdict: buyerWins=true confidence=0.99
<span style="color:#d2a8ff">[arbiter]</span> Reasoning: "Delivery failed — buyer entitled to full refund"

<span style="color:#c84e14">[pipeline]</span> Phase 3: Policy agent reviewing verdict...
<span style="color:#3fb950">[pipeline]</span> Phase 3 result: APPROVED — Verdict aligns with policy

<span style="color:#c84e14">[keeperhub]</span> Simulating resolveDispute(3, true, 0x7532...)...
<span style="color:#3fb950">[keeperhub]</span> Simulation passed — broadcasting transaction...
<span style="color:#3fb950">[keeperhub]</span> ✅ Transaction executed via direct_api!
<span style="color:#3fb950">[keeperhub]</span>    surface:       direct_api
<span style="color:#3fb950">[keeperhub]</span>    tx hash:       0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0
<span style="color:#3fb950">[keeperhub]</span>    execution ID:  7z0t2yr9ecczhx0tfgad6
<span style="color:#3fb950">[keeperhub]</span>    audit trail:   https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6</div>
  </body></html>`);
  await page.waitForTimeout(15000);

  // === Scene 7: Blockscout TX (15s) ===
  console.log('Scene 7: Blockscout transaction...');
  try {
    await page.goto('https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(15000);
  } catch(e) {
    console.log('Blockscout timeout, using fallback');
    await page.setContent(`<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
      <div style="width:1200px;background:#111;border:1px solid #333;border-radius:12px;padding:40px;font-family:system-ui,sans-serif">
        <div style="color:#c84e14;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:20px">Sepolia Blockscout — Transaction</div>
        <div style="margin-bottom:16px"><span style="color:#5a5548">Status:</span> <span style="color:#3fb950;font-weight:600">Success ✓</span></div>
        <div style="margin-bottom:16px"><span style="color:#5a5548">Block:</span> <span style="color:#f0ede6">11,374,381</span></div>
        <div style="margin-bottom:16px"><span style="color:#5a5548">Method:</span> <span style="color:#f0ede6">resolveDispute(uint256,bool,address)</span></div>
        <div style="margin-bottom:16px"><span style="color:#5a5548">From:</span> <span style="color:#c84e14">0x32db418d...3d8b4af</span> <span style="color:#5a5548">(KeeperHub EIP-7702)</span></div>
        <div style="margin-bottom:16px"><span style="color:#5a5548">To:</span> <span style="color:#c84e14">0x8c0c5c07c2ae79492...a535a2</span> <span style="color:#5a5548">(RecourseEscrow)</span></div>
        <div style="margin-bottom:16px"><span style="color:#5a5548">TX Hash:</span> <span style="color:#c84e14">0x6ad71f82bfe80775...056afa0</span></div>
        <div style="padding-top:16px;border-top:1px solid #333;margin-top:20px">
          <span style="color:#3fb950;font-weight:600">Token Transfer: 9.9 USDC → 0x7532A98C...3acCe (Buyer Refund)</span>
        </div>
      </div>
    </body></html>`);
    await page.waitForTimeout(15000);
  }

  // === Scene 8: KeeperHub Audit (11s) ===
  console.log('Scene 8: KeeperHub audit...');
  await page.setContent(`<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="width:900px;background:#111;border:1px solid #333;border-radius:12px;padding:32px;font-family:'Courier New',monospace">
      <div style="color:#c84e14;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px">KeeperHub Audit Trail</div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Execution ID:</span> <span style="color:#f0ede6">7z0t2yr9ecczhx0tfgad6</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Status:</span> <span style="color:#3fb950">Completed</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Surface:</span> <span style="color:#f0ede6">Direct Execution API</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">TX Hash:</span> <span style="color:#c84e14">0x6ad71f82…056afa0</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Block:</span> <span style="color:#f0ede6">11,374,381</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Gas:</span> <span style="color:#f0ede6">Paid by KeeperHub EIP-7702 wallet</span></div>
      <div style="margin-bottom:12px"><span style="color:#5a5548">Outcome:</span> <span style="color:#3fb950">Resolved — buyer wins, 9.9 USDC refunded</span></div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #333;color:#5a5548;font-size:11px">Full audit: app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6</div>
    </div>
  </body></html>`);
  await page.waitForTimeout(11000);

  // === Scene 9: Closing card (7s) ===
  console.log('Scene 9: Closing card...');
  await page.setContent(`<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="text-align:center">
      <div style="font-family:monospace;font-size:56px;font-weight:700;color:#c84e14;margin-bottom:16px">Recourse</div>
      <div style="font-family:system-ui,sans-serif;font-size:18px;color:#8a8578;margin-bottom:24px">Chargebacks for the Machine Economy</div>
      <div style="font-family:monospace;font-size:16px;color:#f0ede6;margin-bottom:8px">The agent decides. KeeperHub executes.</div>
      <div style="font-family:monospace;font-size:12px;color:#5a5548;margin-top:24px">recourse.dev · github.com/tommycet/recourse-chargebacks</div>
    </div>
  </body></html>`);
  await page.waitForTimeout(7000);

  // Close
  await context.close();
  await browser.close();
  console.log('Recording complete!');
})();
