# Recourse Hackathon Demo Video Plan

## Deliverable
/root/recourse/video/recourse_demo_v2.mp4 — 1920×1080 16:9, h264 MP4, under 8MB

## Structure — Two Parts

### Part A: Landing Page Walkthrough (~120s)
Single-page scroll controller: all content in one HTML page with sequential sections.
Scroll waypoints: Hero → Problem → Evidence → Tiered Arbiter → Demo/Stats → Risks → Close
Camera fixed at 1920×1080. Narration explains project (x402, evidence bundles, arbiter, reputation flywheel).

### Part B: Forge Test Terminal Animation (~50s)
Pre-rendered HTML terminal showing real forge test output typed character-by-character.
Green PASS lines, cursor blink, all 7 tests showing pass.

## Visual Recording Technique
- Playwright recordVideo at 1920×1080
- HTTP server serves from /root/recourse/web/
- Single-page controller: both Part A and Part B in one HTML page as sequential full-screen divs
- Smooth scrollTo between sections with delays
- NO external images (embed all as data URIs / inline SVG)
- NO rgba() with alpha < 1.0
- NO backdrop-filter

## Narration
- edge-tts with en-US-AndrewMultilingualNeural at -5% rate
- Script focuses on PROJECT (architecture, x402, evidence bundles, escrow contract, arbiter tiers, reputation flywheel, competitive scan, security, data-moat)
- NEVER describes page layout
- Duration matched to visuals

## Assembly
1. WebM → MP4 (ffmpeg -vf scale=1920:1080, fps=30)
2. Mux with narration audio
3. Compress if > 8MB with higher CRF

## Verification
- Extract frames at regular intervals
- Verify with vision_analyze
- Check final size and duration

## Environment
- forge: /root/.foundry/bin/forge
- edge-tts: /root/.agent-reach-venv/bin/edge-tts
- ffmpeg: /usr/bin/ffmpeg
- node: v22.14.0
- xvfb-run: /usr/bin/xvfb-run