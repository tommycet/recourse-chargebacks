// gen_narration_v9b.js — Edge TTS narration with CONCAT (not amix) to prevent overlap
// Each clip is truncated to fit its time window with 0.5s gap
// Clips are concatenated with silence padding — NO amix averaging, NO overlap

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ts = JSON.parse(fs.readFileSync(path.join(__dirname, 'v9_timestamps.json'), 'utf-8'));
const s = ts.scenes;

// Narration texts — SHORT, fits the time windows (edge-tts -5% ≈ 12.8 chars/sec)
// Each clip must end 0.5s before the next clip starts
const clips = [
  { name: '01_hero', start: 0.5, maxDur: 12.0, text:
    'x402 is the new payment protocol for AI agents. But x402 has no chargebacks. If an agent pays and the service never delivers, the money is gone. Recourse fixes this.' },

  { name: '02_primitives', start: s.primitives_start + 1.0, maxDur: 10.9, text:
    'Three primitives. On-chain escrow locks the USDC. AI dispute resolution evaluates evidence. KeeperHub executes the settlement.' },

  { name: '03_how', start: s.how_start + 1.0, maxDur: 10.2, text:
    'Lock funds when one agent hires another. If delivery fails, raise a dispute. The arbiter evaluates evidence and KeeperHub executes the verdict on-chain.' },

  { name: '04_launch', start: s.launch_start + 0.5, maxDur: 5.5, text:
    'Let us see this in action.' },

  { name: '05_offline', start: s.offline_start + 0.3, maxDur: 5.1, text:
    'Connecting in offline demo mode.' },

  { name: '06_workspace', start: s.workspace_start + 1.0, maxDur: 14.0, text:
    'This is the escrow dashboard. Left sidebar shows real Sepolia contract addresses. The center shows the four-phase pipeline: evidence verifier, AI arbiter, policy agent, KeeperHub.' },

  { name: '07_form', start: s.form_start + 2.0, maxDur: 32.4, text:
    'We create an escrow for ten USDC. The smart contract locks the funds. The buyers agent has now committed payment held in escrow until delivery is confirmed or a dispute is resolved.' },

  { name: '08_dispute', start: s.dispute_start + 1.0, maxDur: 14.3, text:
    'The seller fails to deliver. We raise a dispute. The escrow freezes immediately. Phase one verifies the cryptographic evidence bundle.' },

  { name: '09_execsim', start: s.execsim_start + 1.0, maxDur: 20.7, text:
    'The AI arbiter runs a large language model. It analyzes the evidence and renders a verdict. Buyer wins. The policy agent confirms authorization. KeeperHub broadcasts the settlement on Sepolia.' },

  { name: '10_aftermath', start: s.aftermath_start + 1.0, maxDur: 13.5, text:
    'The audit trail captures everything. Encoded contract call data, verdict, block number, gas used, and a direct link to the real Blockscout transaction.' },

  { name: '11_closing', start: s.closing_start + 1.0, maxDur: 8.4, text:
    'Recourse. The agent decides. KeeperHub executes. Chargebacks for the machine economy.' },
];

const OUTDIR = path.join(__dirname, 'narration-v9b');
const WAVDIR = path.join(OUTDIR, 'wavs');
fs.mkdirSync(WAVDIR, { recursive: true });

console.log('Generating narration clips (edge-tts)...');
const generated = [];

for (const clip of clips) {
  const rawWav = path.join(WAVDIR, `${clip.name}_raw.wav`);
  const trimWav = path.join(WAVDIR, `${clip.name}.wav`);
  const safeText = clip.text.replace(/"/g, '\\"');

  try {
    execSync(`edge-tts --voice en-US-AndrewMultilingualNeural --rate="-5%" --text "${safeText}" --write-media "${rawWav}"`, { timeout: 20000 });
    // Truncate to maxDur
    execSync(`ffmpeg -y -i "${rawWav}" -t ${clip.maxDur} -c copy "${trimWav}" 2>/dev/null`);
    const dur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${trimWav}"`, { encoding: 'utf-8' }).trim());
    console.log(`  ${clip.name}: ${dur.toFixed(1)}s (max ${clip.maxDur}s) ✓`);
    generated.push({ ...clip, wavPath: trimWav, duration: dur });
  } catch (e) {
    console.error(`  ${clip.name}: FAILED ${e.message.slice(0, 80)}`);
  }
}

// Build full track using CONCAT with silence padding between clips
// Total duration = video duration + 2s
const totalDuration = ts.totalDuration + 2;
console.log(`\nBuilding narration track (${totalDuration.toFixed(1)}s) via concat with silence padding...`);

// For each clip, create a padded segment: silence from 0 to clip.start, then clip audio, then silence until next clip
const segDir = path.join(OUTDIR, 'segments');
fs.mkdirSync(segDir, { recursive: true });

for (let i = 0; i < generated.length; i++) {
  const g = generated[i];
  const segPath = path.join(segDir, `seg_${String(i).padStart(2, '0')}.wav`);

  // Calculate silence before this clip
  const prevEnd = i > 0 ? generated[i-1].start + generated[i-1].duration : 0;
  const silenceBefore = Math.max(0, g.start - prevEnd);

  // Calculate silence after (until next clip or end)
  const nextStart = i + 1 < generated.length ? generated[i+1].start : totalDuration;
  const silenceAfter = Math.max(0.5, nextStart - g.start - g.duration);

  // Create padded segment: silence_before + clip + silence_after
  const filterParts = [];
  let inputIdx = 0;
  let inputs = '';

  // Input 0: silence before
  if (silenceBefore > 0.01) {
    inputs += `-f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 `;
    filterParts.push(`[${inputIdx}]atrim=0:${silenceBefore.toFixed(3)}[pre]`);
    inputIdx++;
  }

  // Input 1: clip audio
  inputs += `-i "${g.wavPath}" `;
  filterParts.push(`[${inputIdx}]aformat=sample_rates=44100:channel_layouts=mono[clip]`);
  inputIdx++;

  // Input 2: silence after
  inputs += `-f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 `;
  filterParts.push(`[${inputIdx}]atrim=0:${silenceAfter.toFixed(3)}[post]`);
  inputIdx++;

  // Concat all parts
  let concatInputs = '';
  if (silenceBefore > 0.01) concatInputs += '[pre]';
  concatInputs += '[clip][post]';
  filterParts.push(`${concatInputs}concat=n=3:v=0:a=1[out]`);

  const cmd = `ffmpeg -y ${inputs} -filter_complex "${filterParts.join(';')}" -map "[out]" -ar 44100 -ac 1 "${segPath}" 2>/dev/null`;
  try {
    execSync(cmd, { timeout: 15000 });
  } catch (e) {
    console.error(`  Segment ${i} failed: ${e.message.slice(0, 100)}`);
  }
}

// Concat all segments
const listPath = path.join(segDir, 'concat_list.txt');
fs.writeFileSync(listPath, generated.map((_, i) =>
  `file '${path.join(segDir, `seg_${String(i).padStart(2, '0')}.wav`)}'`
).join('\n'));

const rawTrack = path.join(OUTDIR, 'narration_raw.wav');
execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${rawTrack}" 2>/dev/null`);

// Apply loudnorm
const normTrack = path.join(OUTDIR, 'narration_norm.wav');
console.log('Normalizing with loudnorm...');
execSync(`ffmpeg -y -i "${rawTrack}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" "${normTrack}" 2>/dev/null`);

const dur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${normTrack}"`, { encoding: 'utf-8' }).trim());
console.log(`\nNarration: ${normTrack}`);
console.log(`Duration: ${dur.toFixed(1)}s`);
console.log(`Clips: ${generated.length}`);
