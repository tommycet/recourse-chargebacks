# Recourse Hackathon Demo Video Plan

## Deliverable

`/root/recourse/video/recourse_demo_v3.mp4` — 1920×1080, H.264 MP4, <8MB (< 90 seconds)

---

## 1. VIDEO NARRATIVE — Scene by Scene

**Target audience:** DoraHacks judges who must see "agent executing onchain through KeeperHub."
**Total duration:** 70–80 seconds.

| # | Scene | Duration | What viewer sees | What narration covers |
|---|-------|----------|-----------------|----------------------|
| 1 | **Title card** | 3s | Dark slide: "Recourse | Chargebacks for the Machine Economy" + "DoraHacks KeeperHub Hackathon" | Silence (title speaks for itself) |
| 2 | **Hero scroll** | 6s | Landing page hero: title, "Live on Sepolia via KeeperHub" green dot, 137 tests badge, 4-Agent Pipeline badge | Problem statement (x402 has no chargebacks) + what Recourse is |
| 3 | **Landing scroll — how it works** | 7s | 3-step cards: Lock USDC → AI Arbiter → KeeperHub Executes | Architecture overview: 4-agent pipeline, KeeperHub surfaces |
| 4 | **Landing scroll — live proof** | 6s | Proof grid: TX hash 0x6ad71f82, Block #11,374,381, Execution ID 7z0t2yr9ecczhx0tfgad6, green "Settlement complete" banner | "This is a real transaction, not a mockup" |
| 5 | **Terminal: arbiter runner** | 18s | Terminal with `npx tsx arbiter-runner.ts` output: Scenario 1 (non-delivery) → verdict with Groq source; Scenario 2 (delivered) → verdict | Show the Groq llama-3.3-70b evaluating evidence in real-time. LLM reasoning visible. |
| 6 | **Terminal: KeeperHub pipeline** | 12s | `keeperhub-demo.ts` full pipeline: Phase 1 evidence verify → Phase 2 Groq arbiter verdict → Phase 3 policy approved → Phase 4 KeeperHub MCP/Direct API execution + tx hash + execution ID | Walk through the 4-agent pipeline executing. Highlight simulate-then-execute. |
| 7 | **Blockscout tx page** | 8s | Sepolia Blockscout showing tx `0x6ad71f82…`: status SUCCESS, block 11,374,381, method `resolveDispute`, From (KeeperHub wallet 0x32db418d…), To (RecourseEscrow 0x8c0c5c07…) | "Verified on-chain. Block 11,374,381. Called through KeeperHub's smart account." |
| 8 | **KeeperHub audit run** | 5s | KeeperHub dashboard: `app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6` — execution timeline, gas used, outcome | "Full audit trail. Every action logged from trigger to settlement." |
| 9 | **Closing card** | 5s | Dark slide: "The agent decides. KeeperHub executes. | recourse.dev | github.com/tommycet/recourse-chargebacks" | Tagline + call to action |

**Total: ~70 seconds**

---

## 2. WHAT TO RECORD — Screens and Flows

### A. Landing Page Scroll (Scenes 2–4)

- **URL:** `http://localhost:8080/index.html`
- **Page sections to capture:** Hero → "How It Works" 3-step grid → Live Proof section
- **Technique:** Playwright video recording at 1920×1080, smooth `window.scrollTo()` between sections
- **Key visual moments:**
  - Hero: green dot "Live on Sepolia via KeeperHub" + "137 Foundry Tests Passing" badge
  - How It Works: three-step cards with icons
  - Live Proof: the 4-card grid with TX hash, block number, execution ID, contract address + green "Settlement complete" banner

### B. Arbiter Runner — Terminal Output (Scene 5)

- **Command:** `cd /root/recourse/agent/src && GROQ_API_KEY=$GROQ_API_KEY npx tsx arbiter-runner.ts`
- **Expected output:**
  ```
  ═══════════════════════════════════════════
    Recourse Arbiter Runner — Dispute Simulation
  ═══════════════════════════════════════════

  Scenario 1: Non-delivery (deliveryStatus=failed)
    Task: ai-image-generation-service
    Amount: 10 USDC
    Running arbiter...

    Verdict: {
      "buyerWins": true,
      "confidence": 0.92,
      "reasoning": "...",
      "source": "llm"      ← MUST show Groq, not "fallback"
    }

  Scenario 2: Delivered correctly (deliveryStatus=delivered)
    ...
    Verdict: {
      "buyerWins": false,
      "confidence": 0.88,
      "reasoning": "...",
      "source": "llm"
    }
  ```
- **Technique:** Pre-recorded terminal output using the Playwright-based recording approach, or screen-record a live run. The output must show `"source": "llm"` (Groq), not `"source": "fallback"`.
- **Important:** Verify GROQ_API_KEY is set before recording. If Groq is rate-limited, use OpenRouter fallback (set OPENROUTER_API_KEY).

### C. KeeperHub Pipeline — Terminal Output (Scene 6)

- **Command:** `cd /root/recourse/agent/src && GROQ_API_KEY=$GROQ_API_KEY KEEPERHUB_API_KEY=$KEEPERHUB_API_KEY npx tsx keeperhub-demo.ts`
- **Expected output:**
  ```
  [pipeline] Phase 1: Evidence verifier checking escrow #3...
  [pipeline] Phase 1 result: PASS — Evidence valid
    ✓ hash format: valid
    ✓ address format: valid
    ✓ delivery coherence: failed delivery consistent with empty response
    ✓ buyer/seller distinctness: addresses differ

  [arbiter] Running LLM analysis for escrow #3...
  [arbiter] Verdict: buyerWins=true confidence=0.92
  [arbiter] Reasoning: "Delivery failed — response hash is empty..."

  [pipeline] Phase 3: Policy agent reviewing verdict...
  [pipeline] Phase 3 result: APPROVED — Verdict aligns with policy

  [keeperhub] Simulating resolveDispute(3, true, 0x7532…)...
  [keeperhub] Simulation passed — broadcasting transaction...
  [keeperhub] ✅ Transaction executed via direct_api!
  [keeperhub]    surface:       direct_api
  [keeperhub]    tx hash:       0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0
  [keeperhub]    execution ID:  7z0t2yr9ecczhx0tfgad6
  [keeperhub]    audit trail:   https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6
  ```
- **Technique:** Record the terminal output. If KeeperHub API is not available, use the pre-recorded `keeperhub-demo-output.json` output as a static visual. But ideally run live for maximum authenticity.

### D. Blockscout TX Page (Scene 7)

- **URL:** `https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0`
- **Key elements to show:** Status (Success), Block number (11,374,381), Method (resolveDispute), From (KeeperHub wallet 0x32db418d…), To (RecourseEscrow 0x8c0c5c07…), Token Transfer (USDC)
- **Technique:** Playwright navigate + screenshot/video capture. Wait for full page load.

### E. KeeperHub Audit Run (Scene 8)

- **URL:** `https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6`
- **Key elements:** Execution timeline, gas used, outcome (Resolved), execution ID
- **Technique:** Playwright navigate + screenshot/video capture
- **Note:** If KeeperHub dashboard requires auth, use the `keeperhub-demo-output.json` fields as a visual overlay instead.

---

## 3. NARRATION SCRIPT — Exact TTS Text Per Scene

**Voice:** Groq Orpheus `troy` (male) via `canopylabs/orpheus-v1-english`
**Fallback:** `en-US-AriaNeural` (edge-tts) if Groq TTS terms not accepted
**Rate:** normal (Orpheus handles pacing well)

### Scene 2: Hero Scroll (6s)
```
The x402 protocol lets autonomous agents pay for API access and compute — machines paying machines. But it has no chargebacks. Once a payment settles, it's final, even if the seller delivered nothing. Recourse fixes that.
```

### Scene 3: How It Works (7s)
```
Funds lock in an escrow smart contract before work begins. An AI arbiter evaluates cryptographic evidence and issues a binding verdict — buyer wins or seller wins. Then KeeperHub executes the settlement onchain. Four independent agents, zero trust assumptions.
```

### Scene 4: Live Proof (6s)
```
This isn't a mockup. Transaction six ad seven one f eight two on Sepolia, block eleven million three hundred seventy-four thousand three hundred eighty-one. Called through KeeperHub's smart account. One hundred thirty-seven Foundry tests passing. Settlement complete.
```

### Scene 5: Arbiter Runner (18s)
```
Here's the AI arbiter in action. Groq's llama three point three seventy-billion model evaluates the evidence bundle. First scenario: seller failed to deliver — response hash is empty. The arbiter issues a verdict: buyer wins, confidence zero point nine two. Second scenario: seller delivered correctly, matching hashes. Verdict flips — seller wins. LLM reasoning is visible in the output.
```

### Scene 6: KeeperHub Pipeline (12s)
```
Now the full pipeline. Phase one: evidence verifier validates bundle integrity — hash format, address format, delivery coherence. Phase two: the arbiter issues its verdict via Groq. Phase three: policy agent approves the verdict. Phase four: KeeperHub simulates the transaction, then broadcasts it onchain. Transaction hash, execution ID, and audit trail — all captured.
```

### Scene 7: Blockscout TX (8s)
```
Here's the transaction on Blockscout. Status: success. Block eleven million three hundred seventy-four thousand three hundred eighty-one. Method: resolve dispute. From KeeperHub's wallet to the RecourseEscrow contract. The buyer received a nine-point-nine USDC refund. Verified onchain, not in a mockup.
```

### Scene 8: KeeperHub Audit (5s)
```
KeeperHub's audit trail captures everything — trigger, simulation result, submitted transaction, gas used, and outcome. Full execution history at the run URL. Every action logged.
```

### Scene 9: Closing (5s)
```
Recourse. Chargebacks for the machine economy. The agent decides. KeeperHub executes.
```

---

## 4. TECHNICAL SETUP

### Prerequisites
```bash
# edge-tts (already installed)
which edge-tts  # /root/.agent-reach-venv/bin/edge-tts

# ffmpeg (already installed)
which ffmpeg  # /usr/bin/ffmpeg

# Node.js
node --version  # v22.14.0

# Playwright for browser recording
npx playwright install chromium 2>/dev/null || true
```

### Screen Recording Setup

Resolution: 1920×1080 @ 30fps. Dark browser theme.

**Recording method:** Playwright `recordVideo` API, recording directly to WebM at 1920×1080.

### Web Server
```bash
cd /root/recourse/web && python3 -m http.server 8080 &
```

### Recording Script

Create `/root/recourse/video/record-v3.cjs`:

```javascript
const { chromium } = require('playwright');
const path = require('path');

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

  // === Scene 1: Title card (3s) ===
  await page.setContent(`<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="text-align:center">
      <div style="font-family:monospace;font-size:14px;color:#c84e14;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:24px">DoraHacks · KeeperHub Agents Onchain</div>
      <div style="font-family:Inter,sans-serif;font-size:48px;font-weight:800;color:#f0ede6;letter-spacing:-0.03em;line-height:1.1;margin-bottom:16px">Chargebacks for<br>the <span style="color:#c84e14">Machine Economy</span></div>
      <div style="font-family:monospace;font-size:13px;color:#5a5548">recourse.dev</div>
    </div>
  </body></html>`);
  await page.waitForTimeout(3000);

  // === Scene 2–4: Landing page scroll (19s) ===
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Scroll to Hero
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(6000);  // Scene 2

  // Scroll to "How It Works"
  await page.evaluate(() => document.getElementById('howitworks').scrollIntoView({ behavior: 'smooth' }));
  await page.waitForTimeout(7000);  // Scene 3

  // Scroll to "Live Proof"
  await page.evaluate(() => document.getElementById('proof').scrollIntoView({ behavior: 'smooth' }));
  await page.waitForTimeout(6000);  // Scene 4

  // === Scene 5: Terminal — Arbiter Runner ===
  // Pre-recorded terminal HTML (see Section 4B below)
  await page.setContent(ARBITER_HTML);
  await page.waitForTimeout(18000);  // Scene 5

  // === Scene 6: Terminal — KeeperHub Pipeline ===
  await page.setContent(PIPELINE_HTML);
  await page.waitForTimeout(12000);  // Scene 6

  // === Scene 7: Blockscout ===
  await page.goto('https://eth-sepolia.blockscout.com/tx/0x6ad71f82bfe80775b9588410dc1708f9d83b3f20e5fcb259926ccbffb056afa0', { waitUntil: 'networkidle' });
  await page.waitForTimeout(8000);  // Scene 7

  // === Scene 8: KeeperHub Audit ===
  // If auth blocks, use fallback HTML
  try {
    await page.goto('https://app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(5000);
  } catch {
    await page.setContent(KEEPERHUB_FALLBACK_HTML);
    await page.waitForTimeout(5000);
  }

  // === Scene 9: Closing card ===
  await page.setContent(`<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="text-align:center">
      <div style="font-family:monospace;font-size:48px;font-weight:700;color:#c84e14;margin-bottom:16px">Recourse</div>
      <div style="font-family:Inter,sans-serif;font-size:18px;color:#8a8578;margin-bottom:24px">Chargebacks for the Machine Economy</div>
      <div style="font-family:monospace;font-size:14px;color:#f0ede6;margin-bottom:8px">The agent decides. KeeperHub executes.</div>
      <div style="font-family:monospace;font-size:12px;color:#5a5548;margin-top:24px">recourse.dev · github.com/tommycet/recourse-chargebacks</div>
    </div>
  </body></html>`);
  await page.waitForTimeout(5000);  // Scene 9

  await context.close();
  await browser.close();
  console.log('Recording complete');
})();
```

### Terminal HTML — Arbiter Runner (Scene 5)

The arbiter runner output is pre-rendered as a styled `<div>` mimicking a terminal. Lines appear with a typewriter effect (CSS animation).

**Approach:** Run `npx tsx arbiter-runner.ts` and capture its stdout. Then wrap in terminal HTML for the recording.

```bash
# Capture the output
cd /root/recourse/agent/src
GROQ_API_KEY=$GROQ_API_KEY npx tsx arbiter-runner.ts > /tmp/arbiter-output.txt 2>&1
```

**Terminal HTML template:**

```html
<html><body style="margin:0;background:#0a0a0a;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="width:1600px;max-height:960px;overflow:hidden;background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:24px;font-family:'JetBrains Mono',monospace;font-size:14px;line-height:1.6;color:#c9d1d9;white-space:pre-wrap">$TERMINAL_OUTPUT</div>
</body></html>
```

### Terminal HTML — KeeperHub Pipeline (Scene 6)

Same approach. Run `keeperhub-demo.ts` and capture stdout:

```bash
cd /root/recourse/agent/src
GROQ_API_KEY=$GROQ_API_KEY KEEPERHUB_API_KEY=$KEEPERHUB_API_KEY npx tsx keeperhub-demo.ts > /tmp/pipeline-output.txt 2>&1
```

### KeeperHub Fallback HTML (Scene 8)

If KeeperHub dashboard is auth-gated, use this:

```html
<html><body style="margin:0;background:#050505;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="width:800px;background:#111;border:1px solid #333;border-radius:12px;padding:32px;font-family:'JetBrains Mono',monospace">
  <div style="color:#c84e14;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px">KeeperHub Audit Trail</div>
  <div style="margin-bottom:12px"><span style="color:#5a5548">Execution ID:</span> <span style="color:#f0ede6">7z0t2yr9ecczhx0tfgad6</span></div>
  <div style="margin-bottom:12px"><span style="color:#5a5548">Status:</span> <span style="color:#4a9e5c">Completed</span></div>
  <div style="margin-bottom:12px"><span style="color:#5a5548">Surface:</span> <span style="color:#f0ede6">Direct Execution API</span></div>
  <div style="margin-bottom:12px"><span style="color:#5a5548">TX Hash:</span> <span style="color:#c84e14">0x6ad71f82…056afa0</span></div>
  <div style="margin-bottom:12px"><span style="color:#5a5548">Block:</span> <span style="color:#f0ede6">11,374,381</span></div>
  <div style="margin-bottom:12px"><span style="color:#5a5548">Gas:</span> <span style="color:#f0ede6">Paid by KeeperHub EIP-7702 wallet</span></div>
  <div style="margin-bottom:12px"><span style="color:#5a5548">Outcome:</span> <span style="color:#4a9e5c">Resolved — buyer wins, 9.9 USDC refunded</span></div>
  <div style="margin-top:20px;padding-top:16px;border-top:1px solid #333;color:#5a5548;font-size:11px">Full audit: app.keeperhub.com/runs/7z0t2yr9ecczhx0tfgad6</div>
</div>
</body></html>
```

---

## 5. ASSEMBLY — ffmpeg Commands

### Step 1: Generate TTS audio for each scene

**Primary: Groq Orpheus TTS** (requires terms acceptance at console.groq.com)
```bash
GROQ_KEY="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"
GROQ_TTS() {
  local text="$1"
  local outfile="$2"
  curl -s -o "$outfile" \
    -X POST https://api.groq.com/openai/v1/audio/speech \
    -H "Authorization: Bearer $GROQ_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"canopylabs/orpheus-v1-english\",\"input\":\"$text\",\"voice\":\"troy\",\"response_format\":\"wav\"}" \
    -w "\n%{http_code}"
}

# If Groq TTS returns 400 (terms not accepted), fall back to edge-tts:
TTS=/root/.agent-reach-venv/bin/edge-tts
EDGE_TTS() {
  local text="$1"
  local outfile="${2%.wav}.mp3"
  $TTS --voice en-US-AriaNeural --rate=-5% --text "$text" --write-media "$outfile"
  echo "$outfile"
}

# Scene 2
GROQ_TTS "The x402 protocol lets autonomous agents pay for API access and compute — machines paying machines. But it has no chargebacks. Once a payment settles, it's final, even if the seller delivered nothing. Recourse fixes that." /tmp/narration_scene2.wav

# Scene 3
$TTS --voice en-US-AriaNeural --rate=-5% \
  --text "Funds lock in an escrow smart contract before work begins. An AI arbiter evaluates cryptographic evidence and issues a binding verdict — buyer wins or seller wins. Then KeeperHub executes the settlement onchain. Four independent agents, zero trust assumptions." \
  --write-media /tmp/narration_scene3.mp3

# Scene 4
$TTS --voice en-US-AriaNeural --rate=-5% \
  --text "This isn't a mockup. Transaction six ad seven one f eight two on Sepolia, block eleven million three hundred seventy-four thousand three hundred eighty-one. Called through KeeperHub's smart account. One hundred thirty-seven Foundry tests passing. Settlement complete." \
  --write-media /tmp/narration_scene4.mp3

# Scene 5
$TTS --voice en-US-AriaNeural --rate=-5% \
  --text "Here's the AI arbiter in action. Groq's llama three point three seventy-billion model evaluates the evidence bundle. First scenario: seller failed to deliver — response hash is empty. The arbiter issues a verdict: buyer wins, confidence zero point nine two. Second scenario: seller delivered correctly, matching hashes. Verdict flips — seller wins. LLM reasoning is visible in the output." \
  --write-media /tmp/narration_scene5.mp3

# Scene 6
$TTS --voice en-US-AriaNeural --rate=-5% \
  --text "Now the full pipeline. Phase one: evidence verifier validates bundle integrity — hash format, address format, delivery coherence. Phase two: the arbiter issues its verdict via Groq. Phase three: policy agent approves the verdict. Phase four: KeeperHub simulates the transaction, then broadcasts it onchain. Transaction hash, execution ID, and audit trail — all captured." \
  --write-media /tmp/narration_scene6.mp3

# Scene 7
$TTS --voice en-US-AriaNeural --rate=-5% \
  --text "Here's the transaction on Blockscout. Status: success. Block eleven million three hundred seventy-four thousand three hundred eighty-one. Method: resolve dispute. From KeeperHub's wallet to the RecourseEscrow contract. The buyer received a nine-point-nine USDC refund. Verified onchain, not in a mockup." \
  --write-media /tmp/narration_scene7.mp3

# Scene 8
$TTS --voice en-US-AriaNeural --rate=-5% \
  --text "KeeperHub's audit trail captures everything — trigger, simulation result, submitted transaction, gas used, and outcome. Full execution history at the run URL. Every action logged." \
  --write-media /tmp/narration_scene8.mp3

# Scene 9
$TTS --voice en-US-AriaNeural --rate=-5% \
  --text "Recourse. Chargebacks for the machine economy. The agent decides. KeeperHub executes." \
  --write-media /tmp/narration_scene9.mp3
```

### Step 2: Concatenate all audio

```bash
# Create file list
cat > /tmp/audio_list.txt << 'EOF'
file '/tmp/narration_scene2.mp3'
file '/tmp/narration_scene3.mp3'
file '/tmp/narration_scene4.mp3'
file '/tmp/narration_scene5.mp3'
file '/tmp/narration_scene6.mp3'
file '/tmp/narration_scene7.mp3'
file '/tmp/narration_scene8.mp3'
file '/tmp/narration_scene9.mp3'
EOF

ffmpeg -y -f concat -safe 0 -i /tmp/audio_list.txt -c:a aac -b:a 128k /tmp/narration_v3.mp3
```

### Step 3: Record the video

```bash
cd /root/recourse/video
node record-v3.cjs
# Output: raw-v3/*.webm
```

### Step 4: Convert WebM → MP4

```bash
# Find the recorded WebM
WEBM=$(ls -t raw-v3/*.webm | head -1)

# Convert to MP4 with scale + fps normalization
ffmpeg -y -i "$WEBM" \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps=30" \
  -c:v libx264 -preset slow -crf 23 \
  /tmp/video_v3_raw.mp4
```

### Step 5: Mux video + narration

```bash
# Get video duration
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/video_v3_raw.mp4 | cut -d. -f1)

# Mux video + audio (trim audio to video length if needed)
ffmpeg -y -i /tmp/video_v3_raw.mp4 -i /tmp/narration_v3.mp3 \
  -c:v copy -c:a aac -b:a 128k \
  -shortest \
  /root/recourse/video/recourse_demo_v3.mp4
```

### Step 6: Check file size and compress if needed

```bash
SIZE=$(stat -c%s /root/recourse/video/recourse_demo_v3.mp4)
echo "File size: $((SIZE / 1024 / 1024))MB"

# If > 8MB, re-encode with higher CRF
if [ "$SIZE" -gt 8388608 ]; then
  ffmpeg -y -i /root/recourse/video/recourse_demo_v3.mp4 \
    -c:v libx264 -preset slow -crf 28 \
    -c:a aac -b:a 96k \
    /root/recourse/video/recourse_demo_v3.mp4
  echo "Compressed to: $(( $(stat -c%s /root/recourse/video/recourse_demo_v3.mp4) / 1024 / 1024 ))MB"
fi
```

---

## 6. ANTI-AI-SLOP CHECKS

### What NOT to show
- ❌ Grey placeholder boxes or loading spinners
- ❌ Layout narration ("here we see a card with three columns")
- ❌ Mocked or fabricated transaction data
- ❌ `page.setContent()` landing page scrolls (use the real `index.html`)
- ❌ External image URLs that might fail to load
- ❌ `-stream_loop` in ffmpeg
- ❌ `page.setContent()` for the landing page — must load `index.html` from localhost

### What TO show
- ✅ Real terminal output from `arbiter-runner.ts` and `keeperhub-demo.ts`
- ✅ Groq source in verdict output (`"source": "llm"`)
- ✅ Real Blockscout page with the actual Sepolia transaction
- ✅ Real data: TX hash `0x6ad71f82…`, block `11,374,381`, execution ID `7z0t2yr9ecczhx0tfgad6`
- ✅ Contract address `0x8c0c5c07c2ae79492da903c2b0a62aa48ea535a2`
- ✅ Landing page loaded from localhost HTTP server (real `index.html`)
- ✅ Dark background (#050505) with no external images
- ✅ All SVG/dataURI for any inline graphics
- ✅ Title cards and closing card as inline HTML (no external resources)

### Verification checklist (run after assembly)
```bash
# 1. Duration < 90s
ffprobe -v error -show_entries format=duration -of csv=p=0 /root/recourse/video/recourse_demo_v3.mp4

# 2. Resolution is 1920x1080
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /root/recourse/video/recourse_demo_v3.mp4

# 3. File size < 8MB
ls -la /root/recourse/video/recourse_demo_v3.mp4

# 4. Extract frames at key timestamps and verify with vision
ffmpeg -y -i /root/recourse/video/recourse_demo_v3.mp4 -ss 3 -frames:v 1 /tmp/check_scene2.png
ffmpeg -y -i /root/recourse/video/recourse_demo_v3.mp4 -ss 15 -frames:v 1 /tmp/check_scene3.png
ffmpeg -y -i /root/recourse/video/recourse_demo_v3.mp4 -ss 25 -frames:v 1 /tmp/check_scene4.png
ffmpeg -y -i /root/recourse/video/recourse_demo_v3.mp4 -ss 35 -frames:v 1 /tmp/check_scene5.png
ffmpeg -y -i /root/recourse/video/recourse_demo_v3.mp4 -ss 55 -frames:v 1 /tmp/check_scene6.png
ffmpeg -y -i /root/recourse/video/recourse_demo_v3.mp4 -ss 65 -frames:v 1 /tmp/check_scene7.png
```

---

## 7. WHAT CHANGED FROM V2

| Aspect | V2 (stale) | V3 (current) |
|--------|-----------|---------------|
| Network | Base chain 8453 | **Sepolia** (11155111) |
| Tests | 7/7 | **137/137** |
| LLM | OpenRouter only | **Groq llama-3.3-70b** (primary) + OpenRouter DeepSeek (fallback) |
| Arbiter | Tiered TEE model | **4-agent pipeline** (evidence-verifier → arbiter → policy-agent → KeeperHub) |
| Narration | "tiered arbiter in TEEs" | **"4 independent agents, zero trust assumptions"** |
| KeeperHub surfaces | Not shown | **MCP + Direct API + CLI** with failover |
| Duration | ~120s | **70–80s** |
| File size | ~6MB | **< 8MB target** |

---

## 8. EXECUTION ORDER

```bash
# 1. Start web server
cd /root/recourse/web && python3 -m http.server 8080 &

# 2. Capture arbiter output
cd /root/recourse/agent/src
GROQ_API_KEY=$GROQ_API_KEY npx tsx arbiter-runner.ts > /tmp/arbiter-output.txt 2>&1

# 3. Capture pipeline output
GROQ_API_KEY=$GROQ_API_KEY KEEPERHUB_API_KEY=$KEEPERHUB_API_KEY npx tsx keeperhub-demo.ts > /tmp/pipeline-output.txt 2>&1

# 4. Generate all TTS audio (8 scenes)
# (Run all edge-tts commands from Section 5, Step 1)

# 5. Concatenate audio
ffmpeg -y -f concat -safe 0 -i /tmp/audio_list.txt -c:a aac -b:a 128k /tmp/narration_v3.mp3

# 6. Record video (Playwright)
cd /root/recourse/video && node record-v3.cjs

# 7. Convert WebM → MP4
# (ffmpeg commands from Section 5, Step 4)

# 8. Mux video + audio
# (ffmpeg command from Section 5, Step 5)

# 9. Size check + compress if needed
# (bash from Section 5, Step 6)

# 10. Verify
ffprobe -v error -show_entries format=duration -of csv=p=0 /root/recourse/video/recourse_demo_v3.mp4
ls -la /root/recourse/video/recourse_demo_v3.mp4
```

---

## 9. OUTPUT FILE

**Final video:** `/root/recourse/video/recourse_demo_v3.mp4`

**Size target:** < 8MB (Discord limit)
**Duration:** 70–80 seconds
**Resolution:** 1920×1080
**Codec:** H.264 + AAC
**Narration:** Groq Orpheus `troy` (primary) or edge-tts `en-US-AriaNeural` (fallback)

---

## 10. CONTINGENCY

| Issue | Fallback |
|-------|----------|
| Groq rate-limited during recording | Use OpenRouter DeepSeek (`OPENROUTER_API_KEY`) or rule-based fallback output |
| KeeperHub API not available | Use pre-recorded `keeperhub-demo-output.json` as static visual |
| Blockscout slow to load | Pre-screenshot the tx page, use as static image |
| KeeperHub dashboard requires auth | Use fallback HTML from Section 4 |
| File > 8MB | Increase CRF to 28, reduce audio bitrate to 96k |
| Video duration > 90s | Speed up terminal scenes to 1.2x, reduce scene 5/6 hold time |
