#!/usr/bin/env node
/**
 * Generates candidate click sound takes with the ElevenLabs sound effects API,
 * then trims and normalizes them so they can be auditioned side by side.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node scripts/generate-click-sounds.mjs [--takes 4] [--out DIR] [--only mouse,trackpad]
 *   node scripts/generate-click-sounds.mjs --process-only --out DIR   # re-trim raw takes already in DIR/raw
 *
 * Output (DIR defaults to $TMPDIR/screenforge-click-takes):
 *   raw/<sound>-<part>-<n>.mp3     what the API returned (about 0.5 s each)
 *   takes/<sound>-<part>-<n>.wav   onset-aligned, 150 ms, mono 48 kHz, peak -3 dBFS
 *   audition.wav                   every take in order, 0.5 s apart, for listening
 *   takes.json                     which file is which, in audition order
 *
 * Takes are not added to the app: pick the best ones by ear first.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const DRY =
  'Isolated single sound, close-miked, dry studio recording, no reverb, no room tone, no background noise.';

// Each sound gets a press take and, where the sound has one, a lighter release take.
const SOUNDS = {
  mouse: {
    press: `One crisp click of a computer mouse's left button being pressed, plastic micro-switch. ${DRY}`,
    release: `One light click of a computer mouse's left button being released, softer than a press. ${DRY}`,
  },
  trackpad: {
    press: `One press of a laptop glass trackpad, short low soft haptic thock. ${DRY}`,
    release: `One release of a laptop glass trackpad, very short faint higher tick. ${DRY}`,
  },
  soft: {
    press: `One very soft muted click, gentle rounded tap of a quiet silent-switch mouse. ${DRY}`,
    release: `One very faint soft release tick of a quiet silent-switch mouse. ${DRY}`,
  },
  pop: {
    press: `One short playful bubble pop user interface sound, clean and bright. ${DRY}`,
  },
  tick: {
    press: `One tiny crisp digital tick user interface sound, extremely short and clean. ${DRY}`,
  },
};

const TRIM_SECONDS = 0.15;
const FADE_SECONDS = 0.04;
const PEAK_DBFS = -3;
const AUDITION_GAP_SECONDS = 0.5;

function parseArgs(argv) {
  const args = {
    takes: 4,
    out: path.join(os.tmpdir(), 'screenforge-click-takes'),
    only: null,
    processOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--takes') args.takes = Number(argv[++i]);
    else if (arg === '--out') args.out = path.resolve(argv[++i]);
    else if (arg === '--only') args.only = argv[++i].split(',').map((s) => s.trim());
    else if (arg === '--process-only') args.processOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.takes) || args.takes < 1 || args.takes > 10) {
    throw new Error('--takes must be a whole number from 1 to 10');
  }
  return args;
}

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(stderr)
        : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

async function generateTake(apiKey, text, file) {
  const response = await fetch(`${API_URL}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, duration_seconds: 0.5, prompt_influence: 0.6 }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`ElevenLabs returned ${response.status}: ${detail}`);
  }
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
}

/** Starts the take at its first transient, keeps 150 ms, fades the tail and peaks it at -3 dBFS. */
async function processTake(rawFile, outFile) {
  const shape = [
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.002',
    `atrim=0:${TRIM_SECONDS}`,
    `afade=t=out:st=${TRIM_SECONDS - FADE_SECONDS}:d=${FADE_SECONDS}`,
    'aformat=sample_rates=48000:channel_layouts=mono',
  ].join(',');
  // Shape into a float file first: a gain stage chained after silenceremove in
  // the same filter graph does not land on the measured peak.
  const shapedFile = `${outFile}.shaped.wav`;
  await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    rawFile,
    '-af',
    shape,
    '-c:a',
    'pcm_f32le',
    shapedFile,
  ]);
  try {
    const stats = await run('ffmpeg', [
      '-hide_banner',
      '-i',
      shapedFile,
      '-af',
      'astats=metadata=0:measure_perchannel=none',
      '-f',
      'null',
      '-',
    ]);
    const match = stats.match(/Peak level dB:\s*(-?[\d.]+|-inf)/);
    if (!match || match[1] === '-inf') {
      throw new Error(`No audio found in ${path.basename(rawFile)}`);
    }
    const gain = PEAK_DBFS - Number(match[1]);
    await run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      shapedFile,
      '-af',
      `volume=${gain.toFixed(2)}dB`,
      '-c:a',
      'pcm_s16le',
      outFile,
    ]);
  } finally {
    await fs.rm(shapedFile, { force: true });
  }
}

async function buildAudition(takeFiles, outFile) {
  const inputs = takeFiles.flatMap((file) => ['-i', file]);
  const padded = takeFiles
    .map((_, i) => `[${i}:a]apad=whole_dur=${AUDITION_GAP_SECONDS}[a${i}]`)
    .join(';');
  const concat = `${takeFiles.map((_, i) => `[a${i}]`).join('')}concat=n=${takeFiles.length}:v=0:a=1[out]`;
  await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    `${padded};${concat}`,
    '-map',
    '[out]',
    outFile,
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!args.processOnly && !apiKey) {
    throw new Error(
      'Set ELEVENLABS_API_KEY to generate takes (or pass --process-only to re-trim existing ones).',
    );
  }

  const rawDir = path.join(args.out, 'raw');
  const takesDir = path.join(args.out, 'takes');
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(takesDir, { recursive: true });

  const plan = Object.entries(SOUNDS)
    .filter(([sound]) => !args.only || args.only.includes(sound))
    .flatMap(([sound, parts]) =>
      Object.entries(parts).flatMap(([part, text]) =>
        Array.from({ length: args.takes }, (_, i) => ({
          sound,
          part,
          text,
          name: `${sound}-${part}-${i + 1}`,
        })),
      ),
    );

  const done = [];
  for (const take of plan) {
    const rawFile = path.join(rawDir, `${take.name}.mp3`);
    const outFile = path.join(takesDir, `${take.name}.wav`);
    try {
      if (!args.processOnly) {
        process.stdout.write(`Generating ${take.name}… `);
        await generateTake(apiKey, take.text, rawFile);
      } else if (!(await fs.stat(rawFile).catch(() => null))) {
        continue;
      }
      await processTake(rawFile, outFile);
      done.push({ ...take, file: outFile });
      if (!args.processOnly) process.stdout.write('done\n');
    } catch (error) {
      process.stdout.write(`failed: ${error.message}\n`);
    }
  }

  if (done.length === 0) {
    throw new Error('No takes were produced.');
  }
  await buildAudition(
    done.map((take) => take.file),
    path.join(args.out, 'audition.wav'),
  );
  await fs.writeFile(
    path.join(args.out, 'takes.json'),
    `${JSON.stringify(
      done.map(({ name, sound, part, text }, i) => ({
        order: i + 1,
        startsAt: i * AUDITION_GAP_SECONDS,
        name,
        sound,
        part,
        prompt: text,
      })),
      null,
      2,
    )}\n`,
  );
  console.log(
    `\n${done.length} takes in ${takesDir}\nListen to ${path.join(args.out, 'audition.wav')} (order in takes.json).`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
