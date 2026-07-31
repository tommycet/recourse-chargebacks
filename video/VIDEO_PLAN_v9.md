# Recourse Demo Video — Production Plan v9

## Goal
A 2-minute video like a human navigating the project in their browser: smooth scrolls, real clicks, real typing, and narration that **explains the project deeply** — what it does, how it works, why it matters. Not a feature list. Not a layout walkthrough.

## Target: ~120s, 1920×1080, <8MB, H.264+AAC

---

## Scene Map

| # | Time | Duration | What Viewer SEES | What Narration SAYS |
|---|------|----------|-------------------|---------------------|
| 1 | 0-12s | 12s | Landing page hero: "Chargebacks for the Machine Economy", badges (Live TX, 137 tests, 4-Agent Pipeline), CTA buttons | "x402 is the new payment protocol for AI agents. But x402 has no chargebacks. If an agent pays for a service and the service never delivers, the money is gone. Recourse fixes this. We add escrow-backed chargebacks to autonomous agent payments — with real USDC, real on-chain escrow, and AI dispute resolution." |
| 2 | 12-22s | 10s | Scroll to "What It Does" — 3 primitive cards (escrow, dispute, settlement) | "Three primitives make it work. On-chain escrow locks the USDC payment before work begins. AI dispute resolution evaluates evidence when something goes wrong. KeeperHub executes the settlement on-chain — no manual wallet needed." |
| 3 | 22-32s | 10s | Scroll to "How It Works" — 3 steps (Lock, Adjudicate, Settle) | "The flow is simple. Lock funds in escrow when an agent hires another agent. If delivery fails, raise a dispute. The arbiter evaluates the evidence and KeeperHub executes the verdict on-chain." |
| 4 | 32-38s | 6s | Scroll back to top, click "Launch Demo" | "Let us see this in action." |
| 5 | 38-42s | 4s | Click "Offline Demo (No Wallet)" | |
| 6 | 42-56s | 14s | Workspace loads — 3-column layout (sidebar with contract addresses + balances, main area with form + pipeline + lifecycle, right panel with transaction log) | "This is the escrow dashboard. On the left, real Sepolia contract addresses for the escrow, USDC token, and arbiter. The right panel is a live transaction log. The center shows the multi-agent pipeline — four phases: evidence verifier, AI arbiter, policy agent, and KeeperHub execution." |
| 7 | 56-70s | 14s | Type into form — amount "10", seller address, task description. Click "Approve USDC & Create Escrow". Escrow appears in sidebar. | "We create an escrow for ten USDC. The smart contract locks the funds. The buyer's agent has now committed payment — it is held in escrow until delivery is confirmed or a dispute is resolved." |
| 8 | 70-80s | 10s | Click "Raise Dispute". Escrow badge changes to Disputed (red). Pipeline phase 1 goes active. | "Now the seller fails to deliver. We raise a dispute. The escrow freezes immediately. The multi-agent pipeline activates — phase one verifies the cryptographic evidence bundle." |
| 9 | 80-98s | 18s | Click "Buyer Wins (Refund)". 4-phase execution sim plays out fully: hash verification, AI arbiter typewriter reasoning, policy checks, gas estimation, KeeperHub broadcast. Phases advance 1→pass, 2→active→pass (typewriter), 3→pass, 4→pass. Badge goes COMPLETED. | "The AI arbiter runs a large language model to evaluate the evidence. It analyzes the delivery status, checks the evidence hashes, and renders a verdict — buyer wins, refund. The policy agent confirms the arbiter is authorized. Then KeeperHub broadcasts the settlement transaction on Sepolia. Gas estimation, MEV protection, block confirmation — all handled by KeeperHub." |
| 10 | 98-112s | 14s | Scroll down to show keystrokes panel (encoded calldata), result summary (escrow #, verdict, block, gas, tx proof), audit trail (execution ID, tx hash, KeeperHub wallet, block, gas) | "The execution audit trail captures everything. The encoded contract call data shows exactly what was submitted. The result summary confirms the verdict, block number, gas used, and links to the real Blockscout transaction. This is the KeeperHub audit trail — every step is logged and verifiable." |
| 11 | 112-120s | 8s | Scroll back to top — final view of complete workspace | "Recourse. The agent decides. KeeperHub executes. Chargebacks for the machine economy." |

## Technical Notes

- **NO page.setContent()** — every frame is the real running demo at localhost:8090
- **Real Playwright clicks** — mouse.move({steps:12}) → mouse.down() → mouse.up() for all buttons
- **Real typing** — page.keyboard.type(text, {delay: 60}) for form fields
- **Smooth scrolling** — scrollIntoView({behavior:'smooth'}) and mouse.wheel()
- **Let animations play** — the 4-phase execution sim has ~18s of real animations. Do NOT rush them.
- **Groq TTS** — test key first. If 400/401, fall back to edge-tts (en-US-AndrewMultilingualNeural, rate=-5%)
- **Audio normalization** — apply loudnorm (I=-16dB, TP=-1.5dB) to final narration track before muxing. The amix filter drags mean volume to -45dB; loudnorm fixes this to broadcast standard.
- **Scene timestamps** — record video first, extract actual timestamps, generate narration to match

## Verification Steps

1. ffprobe: duration, resolution, codec check
2. Extract frames at 6 key timestamps — vision_analyze to confirm real interaction
3. ffmpeg volumedetect — confirm mean > -20dB
4. File size < 8MB
5. Commit to git
