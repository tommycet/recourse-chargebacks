#!/usr/bin/env python3
"""Generate Groq Orpheus TTS narration clips for Recourse demo video v4."""

import subprocess
import os
import sys

GROQ_KEY = "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"
ENDPOINT = "https://api.groq.com/openai/v1/audio/speech"
OUTDIR = "/root/recourse/video/audio_v4"

os.makedirs(OUTDIR, exist_ok=True)

# Narration clips: (filename, text)
# Total narration should be ~110-120s. Orpheus speaks ~1.5-2 words/sec.
# Each clip should be short (10-20 words) for reliability.

CLIPS = [
    ("clip01_intro.wav",
     "Welcome to Recourse. The x40 protocol defines a four step payment flow where funds are sent before delivery is verified. No chargebacks. No disputes. Once settled, the payment is final, even if the seller delivered nothing."),
    
    ("clip02_problem.wav",
     "This is a defect. In the machine economy, autonomous agents transact at machine speed, but bad actors can still fail to deliver. Recourse fixes this with escrow backed safeguards."),
    
    ("clip03_escrow.wav",
     "Funds are locked in a smart contract until the buyer confirms delivery or raises a dispute. Cryptographic evidence bundles capture the request and response payloads as keccak256 hashes committed on chain."),
    
    ("clip04_landing.wav",
     "Let's walk through the live demo. The landing page explains how Recourse works. We scroll through the architecture diagram and the live proof section showing real Sepolia on-chain data."),
    
    ("clip05_click_launch.wav",
     "Clicking Launch Demo takes us to the Recourse Escrow interface."),
    
    ("clip06_connect.wav",
     "We connect in Offline Demo mode, which simulates the full escrow lifecycle without needing a wallet. The interface comes alive with contract info, escrow listing, and a transaction log."),
    
    ("clip07_create.wav",
     "First, we create an escrow. The amount is ten USDC. The smart contract locks the funds. The transaction log updates in real time as the UI responds to each click."),
    
    ("clip08_dispute.wav",
     "Now we raise a dispute. The escrow is frozen. The dispute button pulses red. This triggers the four agent arbitration pipeline."),
    
    ("clip09_pipeline.wav",
     "The pipeline has four phases. Phase one: the evidence verifier validates the evidence bundle hash and payload integrity. Phase two: the AI arbiter, powered by Groq's llama three point three seventy billion parameter model, analyzes the evidence and renders a binding verdict at machine speed. Phase three: the policy agent checks authorization scope and compliance. Phase four: KeeperHub executes the on-chain transaction with retry and MEV protection."),
    
    ("clip10_keeperhub.wav",
     "KeeperHub provides three execution surfaces: MCP, direct API, and command line interface, all with automatic failover."),
    
    ("clip11_terminal.wav",
     "Here's the real arbiter runner. Powered by Groq llama three point three seventy billion, it evaluates evidence bundles and renders verdicts with high confidence. Scenario one: non-delivery, buyer wins, refund. Scenario two: delivered correctly, seller wins, payout."),
    
    ("clip12_blockscout.wav",
     "This is the real Blockscout page showing the actual Sepolia transaction. The dispute was raised, arbitrated, and settled on block eleven million, three hundred seventy four thousand, three hundred eighty one."),
    
    ("clip13_audit.wav",
     "Every action is logged in the audit trail. Execution ID, transaction hash, gas used, block number, all recorded with retry count and MEV protection status."),
    
    ("clip14_cta.wav",
     "Recourse. Chargebacks for the machine economy. Built for DoraHacks Agents Onchain, powered by KeeperHub and Groq."),
]


def generate_clip(filename, text, retries=2):
    outpath = os.path.join(OUTDIR, filename)
    
    # Skip if already exists and has content
    if os.path.exists(outpath) and os.path.getsize(outpath) > 1000:
        print(f"  SKIP (exists): {filename} ({os.path.getsize(outpath)} bytes)")
        return True
    
    payload = '{"model":"canopylabs/orpheus-v1-english","input":' + \
              json_escape(text) + \
              ',"voice":"troy","response_format":"wav"}'
    
    for attempt in range(retries + 1):
        cmd = [
            "curl", "-s", "-o", outpath,
            "-X", "POST", ENDPOINT,
            "-H", f"Authorization: Bearer {GROQ_KEY}",
            "-H", "Content-Type: application/json",
            "-d", payload,
            "--max-time", "120",
        ]
        
        print(f"  Generating: {filename} (attempt {attempt+1})...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=130)
        
        if os.path.exists(outpath) and os.path.getsize(outpath) > 1000:
            size = os.path.getsize(outpath)
            print(f"  OK: {filename} ({size} bytes)")
            return True
        
        print(f"  FAILED attempt {attempt+1}: {result.stderr[:200]}")
        if attempt < retries:
            # Try with shorter text
            text = text[:len(text)*3//4]
            payload = '{"model":"canopylabs/orpheus-v1-english","input":' + \
                      json_escape(text) + \
                      ',"voice":"troy","response_format":"wav"}'
    
    print(f"  GIVING UP on {filename}")
    return False


def json_escape(s):
    import json
    return json.dumps(s)


if __name__ == "__main__":
    print(f"Generating {len(CLIPS)} Groq Orpheus TTS clips...")
    success = 0
    failed = []
    
    for filename, text in CLIPS:
        if generate_clip(filename, text):
            success += 1
        else:
            failed.append(filename)
    
    print(f"\nDone: {success}/{len(CLIPS)} clips generated")
    if failed:
        print(f"Failed: {failed}")
