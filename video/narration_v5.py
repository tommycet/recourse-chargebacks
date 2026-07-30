#!/usr/bin/env python3
"""Generate improved Groq Orpheus TTS narration for Recourse demo video v5.
Narration matches what the viewer actually sees on screen.
Total target: ~110s. Orpheus speaks ~1.5-2 words/sec."""

import subprocess, os, json, time

GROQ_KEY = "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"
ENDPOINT = "https://api.groq.com/openai/v1/audio/speech"
OUTDIR = "/root/recourse/video/audio_v5"
os.makedirs(OUTDIR, exist_ok=True)

CLIPS = [
    # Scene 1: Landing hero (10s)
    ("01_hero.wav",
     "Recourse. Chargebacks for the machine economy. x402 lets agents pay agents, but payments are final with zero delivery verification. Recourse fixes that."),

    # Scene 2: Landing - What it does (10s)  
    ("02_primitives.wav",
     "Three primitives: onchain escrow locks USDC until delivery is confirmed. AI dispute resolution evaluates evidence at machine speed. KeeperHub executes the settlement onchain."),

    # Scene 3: Landing - How it works (8s)
    ("03_how.wav",
     "Three steps: funds lock in escrow. The AI arbiter reviews cryptographic evidence. KeeperHub settles onchain. No human in the loop."),

    # Scene 4: Click Launch Demo → connect (6s)
    ("04_connect.wav",
     "Clicking Launch Demo opens the escrow interface. We connect in Offline Demo mode to simulate the full lifecycle."),

    # Scene 5: Demo workspace - create escrow (10s)
    ("05_create.wav",
     "The workspace shows contract addresses on Sepolia, balances, and the escrow creation form. We enter ten USDC, a seller address, and a task description. The contract locks the funds."),

    # Scene 6: Raise dispute (6s)
    ("06_dispute.wav",
     "Now we raise a dispute. The escrow freezes. The four-agent pipeline activates."),

    # Scene 7: Pipeline visualization (12s)
    ("07_pipeline.wav",
     "Four agents execute in sequence. Evidence verifier checks payload integrity. The AI arbiter, powered by Groq llama-three-three seventy billion, renders a binding verdict. Policy agent approves. KeeperHub broadcasts the onchain transaction."),

    # Scene 8: Terminal arbiter output (10s)
    ("08_arbiter.wav",
     "The arbiter runner shows real Groq LLM output. Scenario one: non-delivery, buyer wins, full refund, confidence one point zero. Scenario two: delivered correctly, seller wins, confidence zero point nine. Source: LLM."),

    # Scene 9: Blockscout proof (8s)
    ("09_blockscout.wav",
     "Real transaction on Sepolia Blockscout. Block eleven million. resolveDispute called from KeeperHub's wallet. Nine point nine USDC refunded. Status: success."),

    # Scene 10: Closing (6s)
    ("10_closing.wav",
     "Recourse. The agent decides. KeeperHub executes. Built for DoraHacks Agents Onchain."),
]

def generate_clip(filename, text, retries=2):
    outpath = os.path.join(OUTDIR, filename)
    if os.path.exists(outpath) and os.path.getsize(outpath) > 1000:
        print(f"  SKIP (exists): {filename} ({os.path.getsize(outpath)} bytes)")
        return True

    payload = json.dumps({"model": "canopylabs/orpheus-v1-english",
                          "input": text, "voice": "troy", "response_format": "wav"})

    for attempt in range(retries + 1):
        cmd = ["curl", "-s", "-o", outpath, "-X", "POST", ENDPOINT,
               "-H", f"Authorization: Bearer {GROQ_KEY}",
               "-H", "Content-Type: application/json",
               "-d", payload, "--max-time", "120"]
        print(f"  Generating: {filename} (attempt {attempt+1})...")
        subprocess.run(cmd, capture_output=True, text=True, timeout=130)

        if os.path.exists(outpath) and os.path.getsize(outpath) > 1000:
            print(f"  OK: {filename} ({os.path.getsize(outpath)} bytes)")
            return True
        print(f"  FAILED attempt {attempt+1}")
        if attempt < retries:
            time.sleep(2)

    print(f"  GIVING UP on {filename}")
    return False

if __name__ == "__main__":
    print(f"Generating {len(CLIPS)} Groq Orpheus TTS clips...")
    success = 0
    for filename, text in CLIPS:
        if generate_clip(filename, text):
            success += 1
        time.sleep(1)  # Rate limit courtesy
    print(f"\nDone: {success}/{len(CLIPS)} clips generated")
