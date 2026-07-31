// gen_narration_v9.js — Edge TTS narration for v9 recording (153s)
// Per-clip generation with timestamps from v9 recording
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Actual scene timestamps from recording
const ts = JSON.parse(fs.readFileSync(path.join(__dirname, 'v9_timestamps.json'), 'utf-8'));
const s = ts.scenes;

// Narration clips — SHORT, matched to scene durations, explaining the PROJECT deeply
const clips = [
  // Scene 1: Hero — explain the PROBLEM (x402 has no chargebacks)
  { name: '01_hero', start: 0.5, text:
    'x402 is the new payment protocol for AI agents. But x402 has no chargebacks. If an agent pays for a service and the service never delivers, the money is gone. Recourse fixes this. We add escrow-backed chargebacks to autonomous agent payments with real USDC, real on-chain escrow, and AI dispute resolution.' },

  // Scene 2: Primitives — what the three components do
  { name: '02_primitives', start: s.primitives_start + 1.0, text:
    'Three primitives make it work. On-chain escrow locks the USDC payment before work begins. AI dispute resolution evaluates cryptographic evidence when something goes wrong. KeeperHub executes the settlement on-chain with no manual wallet needed.' },

  // Scene 3: How It Works — the flow
  { name: '03_how', start: s.how_start + 1.0, text:
    'The flow is simple. Lock funds in escrow when one agent hires another. If delivery fails, raise a dispute. The arbiter evaluates the evidence and KeeperHub executes the verdict on-chain.' },

  // Scene 4: Launch Demo
  { name: '04_launch', start: s.launch_start + 0.5, text:
    'Let us see this in action.' },

  // Scene 5: Offline Demo — brief
  { name: '05_offline', start: s.offline_start + 0.3, text:
    'Connecting in offline demo mode.' },

  // Scene 6: Workspace — deep explanation of the dashboard
  { name: '06_workspace', start: s.workspace_start + 1.0, text:
    'This is the escrow dashboard. On the left, real Sepolia contract addresses for the escrow, USDC token, and arbiter. The right panel is a live transaction log. The center shows the multi-agent pipeline with four phases: evidence verifier, AI arbiter, policy agent, and KeeperHub execution.' },

  // Scene 7: Form + Create — explain what escrow means
  { name: '07_form', start: s.form_start + 2.0, text:
    'We create an escrow for ten USDC. The smart contract locks the funds. The buyers agent has now committed payment held in escrow until delivery is confirmed or a dispute is resolved.' },

  // Scene 8: Raise Dispute — explain dispute mechanism
  { name: '08_dispute', start: s.dispute_start + 1.0, text:
    'Now the seller fails to deliver. We raise a dispute. The escrow freezes immediately. The multi-agent pipeline activates. Phase one verifies the cryptographic evidence bundle.' },

  // Scene 9: Execution Sim — deep explanation of the 4 phases
  { name: '09_execsim', start: s.execsim_start + 1.0, text:
    'The AI arbiter runs a large language model to evaluate the evidence. It analyzes the delivery status, checks the evidence hashes, and renders a verdict. Buyer wins, refund. The policy agent confirms the arbiter is authorized. Then KeeperHub broadcasts the settlement transaction on Sepolia.' },

  // Scene 10: Aftermath — audit trail
  { name: '10_aftermath', start: s.aftermath_start + 1.0, text:
    'The execution audit trail captures everything. The encoded contract call data, the result summary with verdict, block number, gas used, and a direct link to the real Blockscout transaction. Every step is logged and verifiable.' },

  // Scene 11: Closing
  { name: '11_closing', start: s.closing_start + 1.0, text:
    'Recourse. The agent decides. KeeperHub executes. Chargebacks for the machine economy.' },
];

const OUTDIR = path.join(__dirname, 'narration-v9');
const WAVDIR = path.join(OUTDIR, 'wavs');
fs.mkdirSync(WAVDIR, { recursive: true });

console.log('Generating narration clips with edge-tts...');

const generated = [];
for (const clip of clips) {
  const wavPath = path.join(WAVDIR, `${clip.name}.wav`);
  const safeText = clip.text.replace(/"/g, '\\"');
  try {
    console.log(`  ${clip.name}: "${clip.text.slice(0, 50)}..."`);
    execSync(`edge-tts --voice en-US-AndrewMultilingualNeural --rate="-5%" --text "${safeText}" --write-media "${wavPath}"`, { timeout: 20000 });
    const dur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${wavPath}"`, { encoding: 'utf-8' }).trim());
    console.log(`    → ${dur.toFixed(1)}s`);
    generated.push({ ...clip, wavPath, duration: dur });
  } catch (e) {
    console.error(`    FAILED: ${e.message.slice(0, 100)}`);
  }
}

// Compose full narration track with adelay placement
const totalDuration = ts.totalDuration + 2;
const filterParts = [];
const inputs = [];

for (let i = 0; i < generated.length; i++) {
  const g = generated[i];
  const delayMs = Math.round(g.start * 1000);
  inputs.push(`-i "${g.wavPath}"`);
  filterParts.push(`[${i}]adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration}[a${i}]`);
}

const mixInputs = generated.map((_, i) => `[a${i}]`).join('');
filterParts.push(`${mixInputs}amix=inputs=${generated.length}:duration=longest:dropout_transition=0[out]`);

const outPath = path.join(OUTDIR, 'narration_raw.wav');
const cmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterParts.join(';')}" -map "[out]" -ar 44100 -ac 1 "${outPath}" 2>&1`;

console.log('\nMixing narration...');
try {
  execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
} catch (e) {
  console.error('ffmpeg mix failed:', e.stderr ? e.stderr.slice(-500) : e.message);
  process.exit(1);
}

// Apply loudnorm to fix amix volume drop
const normPath = path.join(OUTDIR, 'narration_norm.wav');
console.log('Normalizing audio (loudnorm I=-16dB)...');
execSync(`ffmpeg -y -i "${outPath}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" "${normPath}"`, { timeout: 30000 });

const dur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${normPath}"`, { encoding: 'utf-8' }).trim());
console.log(`\nNarration track: ${normPath}`);
console.log(`Duration: ${dur.toFixed(1)}s`);
console.log(`Scenes: ${generated.length}`);
