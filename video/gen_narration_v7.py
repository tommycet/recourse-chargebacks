#!/usr/bin/env python3
"""Generate missing TTS clips and build full narration."""

import json, os, subprocess, time

VIDEO_DIR = '/root/recourse/video'
CLIPS_DIR = os.path.join(VIDEO_DIR, 'narration_v7')

GROQ_API = 'https://api.groq.com/openai/v1/audio/speech'
GROQ_KEY = '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'

with open(os.path.join(VIDEO_DIR, 'v7_timestamps.json')) as f:
    data = json.load(f)
scenes = data['scenes']

clips = [
    ('hero',        "Welcome to Recourse. Chargebacks for the machine economy. Real USDC, real on-chain escrow, real dispute resolution."),
    ('primitives',  "Three primitives. Onchain escrow locks payment before work begins. AI dispute resolution reviews evidence. KeeperHub executes on-chain settlement."),
    ('how',         "Three simple steps. Lock funds. Adjudicate disputes. Settle on-chain."),
    ('connect',     "Clicking Launch Demo opens the escrow interface."),
    ('workspace',   "The workspace shows contract addresses on Sepolia, balances, and the escrow creation form."),
    ('create',      "We fill in ten USDC and create an escrow."),
    ('dispute',     "Now we raise a dispute. The escrow freezes. The pipeline activates."),
    ('pipeline',    "The arbiter runs a Groq large language model to evaluate the evidence."),
    ('arbiter',     "Two scenarios. Non delivery, the buyer wins. Delivered correctly, the seller wins."),
    ('blocksc',     "Real transaction on Sepolia Blockscout. Block eleven million. Success."),
    ('closing',     "Recourse. The agent decides. KeeperHub executes."),
]

def get_scene_duration(scene_key):
    start_key = scene_key + '_start'
    end_key = scene_key + '_end'
    if start_key in scenes and end_key in scenes:
        return scenes[end_key] - scenes[start_key]
    return 5.0

def generate_tts(text, output_path, max_retries=8):
    payload = json.dumps({
        "model": "canopylabs/orpheus-v1-english",
        "input": text,
        "voice": "troy",
        "response_format": "wav"
    })
    
    for attempt in range(max_retries):
        result = subprocess.run([
            'curl', '-s', '-o', output_path,
            '-w', '%{http_code}',
            '-X', 'POST', GROQ_API,
            '-H', f'Authorization: Bearer {GROQ_KEY}',
            '-H', 'Content-Type: application/json',
            '-d', payload
        ], capture_output=True, text=True)
        
        http_code = result.stdout.strip()
        
        if http_code == '200':
            check = subprocess.run(['file', output_path], capture_output=True, text=True)
            if 'RIFF' in check.stdout or 'WAVE' in check.stdout:
                probe = subprocess.run(
                    ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', output_path],
                    capture_output=True, text=True
                )
                info = json.loads(probe.stdout)
                return float(info['format']['duration'])
        
        print(f"    Attempt {attempt+1} failed (HTTP {http_code}), retrying in 15s...")
        time.sleep(15)
    
    raise Exception(f"Failed to generate TTS after {max_retries} attempts")

def pad_wav(input_path, output_path, target_duration):
    result = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', input_path],
        capture_output=True, text=True
    )
    info = json.loads(result.stdout)
    current_duration = float(info['format']['duration'])
    
    if current_duration >= target_duration:
        subprocess.run(['cp', input_path, output_path], check=True)
        return current_duration
    
    pad_duration = target_duration - current_duration
    subprocess.run([
        'ffmpeg', '-y', '-i', input_path,
        '-af', f'apad=pad_dur={pad_duration}',
        '-ar', '24000', '-ac', '1',
        output_path
    ], capture_output=True, check=True)
    return target_duration

def is_valid_wav(path):
    """Check if file is a valid WAV."""
    if not os.path.exists(path):
        return False
    check = subprocess.run(['file', path], capture_output=True, text=True)
    return 'RIFF' in check.stdout or 'WAVE' in check.stdout

# Generate clips (skip valid ones)
clip_files = []
clip_durations = []
total_duration = 0

print("Generating TTS clips...")
for i, (scene_key, text) in enumerate(clips):
    raw_path = os.path.join(CLIPS_DIR, f'clip_{i:02d}_raw.wav')
    padded_path = os.path.join(CLIPS_DIR, f'clip_{i:02d}.wav')
    
    scene_dur = get_scene_duration(scene_key)
    
    # Check if we already have a valid padded clip
    if is_valid_wav(padded_path):
        print(f"  [{i+1}/{len(clips)}] {scene_key}: already exists, skipping")
        probe = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', padded_path],
            capture_output=True, text=True
        )
        info = json.loads(probe.stdout)
        dur = float(info['format']['duration'])
        clip_files.append(padded_path)
        clip_durations.append(dur)
        total_duration += dur
        continue
    
    print(f"  [{i+1}/{len(clips)}] {scene_key}: {scene_dur:.1f}s target")
    
    # Generate TTS
    tts_dur = generate_tts(text, raw_path)
    print(f"    TTS duration: {tts_dur:.1f}s")
    
    # Pad to scene duration
    final_dur = pad_wav(raw_path, padded_path, scene_dur)
    print(f"    Final duration: {final_dur:.1f}s")
    
    clip_files.append(padded_path)
    clip_durations.append(final_dur)
    total_duration += final_dur
    
    # Rate limit delay
    if i < len(clips) - 1:
        print(f"    Waiting 12s for rate limit...")
        time.sleep(12)

print(f"\nTotal narration duration: {total_duration:.1f}s")

# Concatenate all clips
concat_list = os.path.join(CLIPS_DIR, 'concat.txt')
with open(concat_list, 'w') as f:
    for cf in clip_files:
        f.write(f"file '{cf}'\n")

full_narration = os.path.join(VIDEO_DIR, 'narration_v7_full.wav')
subprocess.run([
    'ffmpeg', '-y', '-f', 'concat', '-safe', '0',
    '-i', concat_list,
    '-ar', '24000', '-ac', '1',
    full_narration
], capture_output=True, check=True)

result = subprocess.run(
    ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', full_narration],
    capture_output=True, text=True
)
info = json.loads(result.stdout)
print(f"Full narration: {float(info['format']['duration']):.1f}s")

clip_info = {
    'total_duration': total_duration,
    'clips': [
        {
            'scene': clips[i][0],
            'text': clips[i][1],
            'target_duration': get_scene_duration(clips[i][0]),
            'actual_duration': clip_durations[i],
            'file': clip_files[i]
        }
        for i in range(len(clips))
    ]
}
with open(os.path.join(VIDEO_DIR, 'v7_narration_info.json'), 'w') as f:
    json.dump(clip_info, f, indent=2)

print("\nDone! Full narration:", full_narration)
