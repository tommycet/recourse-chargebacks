// gen_narration_v8.js — Generate Groq Orpheus narration clips for v8 recording
// Places clips at actual scene timestamps, fills silence with silence padding

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const GROQ_KEY = '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';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/speech';
const VOICE = 'troy';
const MODEL = 'canopylabs/orpheus-v1-english';

// Load scene timestamps
const ts = JSON.parse(fs.readFileSync(path.join(__dirname, 'v8_timestamps.json'), 'utf-8'));
const scenes = ts.scenes;

// Narration texts — SHORT, matched to scene durations
const clips = [
  { name: 'n01_hero', text: 'Welcome to Recourse. Chargebacks for the machine economy.', start: 0.5 },
  { name: 'n02_primitives', text: 'Three primitives. On-chain escrow locks payment. AI dispute resolution reviews evidence. KeeperHub executes settlement.', start: scenes.primitives_start + 0.5 },
  { name: 'n03_how', text: 'Lock funds. Adjudicate disputes. Settle on-chain.', start: scenes.how_start + 0.5 },
  { name: 'n04_launch', text: 'Clicking Launch Demo opens the escrow interface.', start: scenes.launch_start + 0.3 },
  { name: 'n05_offline', text: 'Connect in offline demo mode.', start: scenes.offline_start + 0.3 },
  { name: 'n06_workspace', text: 'The workspace shows contract addresses, balances, and the escrow creation form.', start: scenes.workspace_start + 0.5 },
  { name: 'n07_form', text: 'We fill in ten USDC and create an escrow.', start: scenes.form_start + 1.0 },
  { name: 'n08_create', text: 'Escrow created. Ready for dispute.', start: scenes.create_start + 3.0 },
  { name: 'n09_dispute', text: 'Now we raise a dispute. The escrow freezes. The pipeline activates.', start: scenes.dispute_start + 0.5 },
  { name: 'n10_pipeline', text: 'Evidence verified. The AI arbiter begins analysis.', start: scenes.pipeline_start + 0.3 },
  { name: 'n11_execsim', text: 'The arbiter runs a large language model. Policy checks pass. KeeperHub broadcasts the transaction on Sepolia.', start: scenes.execsim_start + 2.0 },
  { name: 'n12_aftermath', text: 'The audit trail captures every step. Real settlement data.', start: scenes.aftermath_start + 0.5 },
  { name: 'n13_closing', text: 'Recourse. The agent decides. KeeperHub executes.', start: scenes.final_start + 0.3 },
];

const OUTDIR = path.join(__dirname, 'narration-v8');
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

function groqTTS(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ model: MODEL, voice: VOICE, input: text });
    const url = new URL(GROQ_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Groq ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Generating narration clips...');
  const wavDir = path.join(OUTDIR, 'wavs');
  if (!fs.existsSync(wavDir)) fs.mkdirSync(wavDir, { recursive: true });

  const generated = [];

  for (const clip of clips) {
    const wavPath = path.join(wavDir, `${clip.name}.wav`);
    try {
      console.log(`  ${clip.name}: "${clip.text.slice(0, 50)}..."`);
      const audioBuf = await groqTTS(clip.text);
      fs.writeFileSync(wavPath, audioBuf);
      // Get duration
      const info = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${wavPath}"`, { encoding: 'utf-8' }).trim();
      const dur = parseFloat(info);
      console.log(`    → ${dur.toFixed(1)}s`);
      generated.push({ ...clip, wavPath, duration: dur });
      // Brief delay to avoid rate limit
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`    ⚠ Groq failed: ${e.message.slice(0, 80)} — falling back to edge-tts`);
      // Fallback to edge-tts
      const safeText = clip.text.replace(/"/g, '\\"');
      execSync(`edge-tts --voice en-US-AndrewMultilingualNeural --text "${safeText}" --write-media "${wavPath}"`, { timeout: 15000 });
      const info = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${wavPath}"`, { encoding: 'utf-8' }).trim();
      const dur = parseFloat(info);
      console.log(`    → edge-tts ${dur.toFixed(1)}s`);
      generated.push({ ...clip, wavPath, duration: dur });
    }
  }

  // Now compose the full narration track using ffmpeg
  // Strategy: use adelay filter to place each clip at its start time
  const totalDuration = ts.totalDuration + 2; // +2s buffer
  const filterParts = [];
  const inputs = [];

  for (let i = 0; i < generated.length; i++) {
    const g = generated[i];
    const delayMs = Math.round(g.start * 1000);
    inputs.push(`-i "${g.wavPath}"`);
    filterParts.push(`[${i}]adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration}[a${i}]`);
  }

  // Mix all delayed tracks
  const mixInputs = generated.map((_, i) => `[a${i}]`).join('');
  filterParts.push(`${mixInputs}amix=inputs=${generated.length}:duration=longest:dropout_transition=0,afade=t=out:st=${totalDuration - 2}:d=2[out]`);

  const filterComplex = filterParts.join(';');
  const outPath = path.join(OUTDIR, 'narration_full.wav');
  const cmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map "[out]" -ar 44100 -ac 1 "${outPath}" 2>&1`;

  console.log('\nMixing narration track...');
  try {
    execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
  } catch (e) {
    console.error('ffmpeg mix failed:', e.stderr ? e.stderr.slice(-500) : e.message);
    process.exit(1);
  }

  // Check output
  const durInfo = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${outPath}"`, { encoding: 'utf-8' }).trim();
  console.log(`\nNarration track: ${outPath}`);
  console.log(`Duration: ${parseFloat(durInfo).toFixed(1)}s`);
  console.log(`Scenes with narration: ${generated.length}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
