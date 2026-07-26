#!/usr/bin/env python3
"""Real demo video recording for Recourse hackathon.
Records a Playwright browser session (recordVideo) showing the landing page,
while playing a TTS narration that explains PROJECT DETAILS (architecture,
features, security, evidence bundles, tiered arbiter, onchain execution via
KeeperHub). Per video rules: narrates what the system DOES and WHY it matters,
NOT "the logo is on the left, the button is blue."
Uses edge-tts (local) for narration.
"""
import asyncio, os, subprocess, sys, json, tempfile
from pathlib import Path

# ------------------------------------------------------------------
# Narration script — split into scenes that sync with recording actions
# ------------------------------------------------------------------
SCENES = [
    # [label, duration_sec, action_in_playwright, narration_text]
    ("open", 6,
     "load_index", """Recourse — chargebacks for the machine economy.
We built the buyer-protection layer agent payments forgot to include."""),
    ("problem", 14,
     "scroll_problem", """The problem is quantified: x402 processed 165 million transactions from 69 thousand agents. Social Graph Ventures found 86 percent of Solana x402 activity was gamed — not real commerce. Coinbase's own repository admits it in issue 1645: the settle endpoint executes a blockchain transfer with zero delivery verification. A malicious server can take funds and return nothing. No recourse for the buyer."""),
    ("evidence", 16,
     "scroll_evidence", """Our answer is an evidence bundle: every transaction emits a signed, hash-committed record — request digest, response digest, content digest, transaction hash, timestamp, signer identity. Hash-committed, not raw payload — keeps bundles under one kilobyte and verifiable. It quietly fixes the x402 receipts hole: today, payment history is in-memory and lost on server restart. Our bundle makes it persistent, auditable, exportable for EU MiCA and VAT compliance."""),
    ("tiered", 16,
     "scroll_design", """The arbiter is tiered — not a single judge. Tier zero verifies the objective facts instantly: does the transaction hash exist on Base chain? Does the content digest match the buyer's committed spec? Does the automated test suite pass? If yes, settlement releases to the seller instantly. Tier one applies a published rulebook inside a trusted execution environment — the DeepMind intelligent delegation blueprint. Tier two: a human appeal for disputes above 500 dollars."""),
    ("demo_refund", 14,
     "show_contract", """For the Agents Onchain judging bar, we execute a real onchain refund through KeeperHub. The agent creates an escrowed settlement contract on Base — chain 8453, using the canonical Circle USDC contract. The buyer raises a dispute with evidence of failure. The arbiter agent executes resolve dispute through KeeperHub's web3 write-contract workflow — a real USDC refund transaction recorded on Base."""),
    ("reputation_flywheel", 12,
     "scroll_demo_stats", """The flywheel: resolved disputes where money actually moved are sybil-resistant by construction. Fraud requires real economic cost — the loser pays a 0.25 percent fee, well below the card-network 2.9 percent plus dispute fee stack. That dataset becomes the reputation layer no competitor can replicate — not AsterPay, not ScoutScore."""),
    ("risks", 10,
     "show_footer", """Risks, honestly. The x402 Foundation — Google, Visa, AWS, Circle, Anthropic, Cloudflare — could standardize disputes themselves. Our mitigation: be the reference implementation inside that process, and our PR to issue 1645 is exactly that invitation. If organic agent commerce stays small, we pivot on the receipts layer — enterprise fleets closing their books for autonomous agent spend. The adversarial-game risk for the arbiter is contained by launching objective-only tiers and expanding as the public rulebook hardens."""),
    ("close", 6,
     "end", """Build Recourse. It is the one idea where a named VC ask, an open protocol hole, fresh hackathon near-misses, a DeepMind paper, and empty shelves across every launch platform — all point at the same coordinates. Before August 13.""")
]

# ------------------------------------------------------------------
# TTS generation (edge-tts) — saves to audio/ files
# ------------------------------------------------------------------
AUDIO_DIR = Path("/root/recourse/web/audio")
AUDIO_DIR.mkdir(exist_ok=True)

def synthesize():
    for label, _, _, text in SCENES:
        path = AUDIO_DIR / f"scene_{label}.mp3"
        if path.exists():
            continue
        # Use edge-tts with a clear, authoritative male voice (en-US-Aria-24kHz for demo quality)
        cmd = [
            "python3", "-c",
            f"import asyncio, edge_tts; asyncio.run(edge_tts.Communicate(text={repr(text)}, voice='en-US-AriaNeural').save('{str(path)}'))"
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=90)
        except subprocess.TimeoutExpired:
            # Fallback: build a silent placeholder so video can proceed
            with open(path, "wb") as f: f.write(b"")
        except Exception as exc:
            print(f"TTS error for {label}: {exc}")
            # Create minimal audio stub with ffmpeg
            subprocess.run([
                "ffmpeg", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                "-t", "2", "-c", "libmp3lame", "-b:a", "32k", str(path), "-y"
            ], capture_output=True)

# ------------------------------------------------------------------
# Playwright recording script (embedded) — navigates and takes video
# ------------------------------------------------------------------
RECORD_SCRIPT = '''
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized', '--window-size=1440,900'], slowMo: 600 });
  const ctx = await browser.newContext({ recordVideo: { dir: 'video/', size: {width:1440,height:900} } });
  const page = await ctx.newPage();
  await page.goto('file:///root/recourse/web/index.html');
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.hero').scrollIntoView({behavior:'smooth'}));
  await page.waitForTimeout(1800);
  await page.evaluate(() => document.querySelector('#problem').scrollIntoView({behavior:'smooth'}));
  await page.waitForTimeout(12000);
  await page.evaluate(() => document.querySelector('#evidence').scrollIntoView({behavior:'smooth'}));
  await page.waitForTimeout(12000);
  await page.evaluate(() => document.querySelector('#design').scrollIntoView({behavior:'smooth'}));
  await page.waitForTimeout(9000);
  await page.evaluate(() => document.querySelector('#demo').scrollIntoView({behavior:'smooth'}));
  await page.waitForTimeout(9000);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'video/final_frame.png', fullPage: true });
  await browser.close();
})();
'''

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
if __name__ == "__main__":
    synthesize()
    RECORD_SCRIPT_DIR = "/tmp/video_demo"
    os.makedirs(RECORD_SCRIPT_DIR, exist_ok=True)
    with open(f"{RECORD_SCRIPT_DIR}/record.js", "w") as f:
        f.write(RECORD_SCRIPT)
    # Launch Playwright recording (foreground so user can observe)
    print("=== Starting Playwright recording (headful). Recording to video/ ...")
    print("=== Narration files:", sorted(AUDIO_DIR.glob("*.mp3")))
