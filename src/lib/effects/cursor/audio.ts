import type { CursorClickSound } from '../../../store';

type AudioContextLike = AudioContext | OfflineAudioContext;

/**
 * Click sounds are synthesized, not sampled: each one is a short filtered-noise
 * transient plus a few exponentially decaying sine "modes" (the resonances of a
 * switch or a trackpad body). That keeps them license-free, tiny, and identical
 * between the live preview (AudioContext) and export (OfflineAudioContext).
 */
type NoiseLayer = {
  kind: 'noise';
  /** High-pass cutoff (Hz). */
  hp: number;
  /** Low-pass cutoff (Hz). */
  lp: number;
  /** Exponential decay time constant (s). */
  tau: number;
  gain: number;
};

type ModeLayer = {
  kind: 'mode';
  /** Start frequency (Hz). */
  f: number;
  /** Optional end frequency (Hz) for a pitch sweep. */
  to?: number;
  /** Sweep duration (s). Defaults to 3 × tau. */
  sweep?: number;
  tau: number;
  gain: number;
  attack?: number;
};

type ClickSoundLayer = NoiseLayer | ModeLayer;

type ClickSoundProfile = {
  /** Loudness-matching gain: every profile peaks at about -4 dBFS at volume 1. */
  norm: number;
  press: ClickSoundLayer[];
  /** Mouse-up: the press layers again, quieter and pitched up. Null = silent release. */
  release: { gain: number; pitch: number } | null;
};

export type ClickSoundHitOptions = {
  /** True for the mouse-up half of a click. */
  release?: boolean;
  /** Click index; seeds the per-click pitch/level variation so renders are reproducible. */
  index?: number;
};

export type ClickSoundHit = {
  /** Time in the same time base as the click events it was built from. */
  t: number;
  release: boolean;
  index: number;
};

export const CLICK_SOUND_OPTIONS: readonly CursorClickSound[] = [
  'none',
  'mouse',
  'trackpad',
  'soft',
  'pop',
  'tick',
];

/** Presets removed in favour of the current set, mapped to their closest replacement. */
const LEGACY_CLICK_SOUNDS: Record<string, CursorClickSound> = {
  'magic-mouse': 'trackpad',
  'mx-master': 'mouse',
};

const CLICK_SOUND_PROFILES: Record<Exclude<CursorClickSound, 'none'>, ClickSoundProfile> = {
  soft: {
    norm: 0.684,
    press: [
      { kind: 'noise', hp: 350, lp: 2600, tau: 0.0022, gain: 0.55 },
      { kind: 'mode', f: 1450, tau: 0.0045, gain: 0.22 },
      { kind: 'mode', f: 230, to: 170, tau: 0.01, gain: 0.45 },
    ],
    release: { gain: 0.32, pitch: 1.12 },
  },
  mouse: {
    norm: 0.4,
    press: [
      { kind: 'noise', hp: 2200, lp: 12000, tau: 0.001, gain: 0.6 },
      { kind: 'mode', f: 3400, tau: 0.008, gain: 0.32 },
      { kind: 'mode', f: 5700, tau: 0.005, gain: 0.18 },
      { kind: 'mode', f: 1180, tau: 0.007, gain: 0.22 },
      { kind: 'mode', f: 330, tau: 0.009, gain: 0.22 },
    ],
    release: { gain: 0.5, pitch: 1.09 },
  },
  trackpad: {
    norm: 0.351,
    press: [
      { kind: 'mode', f: 270, to: 175, sweep: 0.02, tau: 0.011, gain: 0.85, attack: 0.0008 },
      { kind: 'noise', hp: 1600, lp: 7000, tau: 0.0013, gain: 0.32 },
      { kind: 'mode', f: 2150, tau: 0.0035, gain: 0.14 },
    ],
    release: { gain: 0.55, pitch: 1.18 },
  },
  pop: {
    norm: 0.389,
    press: [
      { kind: 'mode', f: 420, to: 1150, sweep: 0.03, tau: 0.016, gain: 0.7, attack: 0.002 },
      { kind: 'noise', hp: 3000, lp: 9000, tau: 0.0007, gain: 0.12 },
    ],
    release: null,
  },
  tick: {
    norm: 0.56,
    press: [
      { kind: 'mode', f: 2900, tau: 0.0022, gain: 0.7 },
      { kind: 'mode', f: 5900, tau: 0.0012, gain: 0.22 },
      { kind: 'noise', hp: 4000, lp: 14000, tau: 0.0005, gain: 0.15 },
    ],
    release: null,
  },
};

/** Gap between press and release when auditioning a sound from the widget. */
const PREVIEW_RELEASE_DELAY = 0.095;
const NOISE_BUFFER_SECONDS = 0.08;
const NOISE_BUFFER_CACHE = new Map<number, AudioBuffer>();
let previewAudioContext: AudioContext | null = null;
let previewClickIndex = 0;

export function normalizeCursorClickSound(value: unknown): CursorClickSound {
  if (typeof value !== 'string') {
    return 'none';
  }
  if ((CLICK_SOUND_OPTIONS as readonly string[]).includes(value)) {
    return value as CursorClickSound;
  }
  return LEGACY_CLICK_SOUNDS[value] ?? 'none';
}

/**
 * Turns click (mouse-down) events into sound hits: one press per click, plus a
 * release at the first mouse-up after it, when one was recorded. Hits are sorted
 * by time, so a drag's release can land after a later click.
 */
export function buildClickSoundHits(
  clickEvents: readonly { t: number }[],
  pressEvents: readonly { t: number; isDown: boolean }[] | undefined,
): ClickSoundHit[] {
  const releaseTimes = (pressEvents ?? [])
    .filter((event) => !event.isDown)
    .map((event) => event.t)
    .sort((a, b) => a - b);

  const hits: ClickSoundHit[] = [];
  let releaseCursor = 0;
  clickEvents.forEach((click, index) => {
    hits.push({ t: click.t, release: false, index });
    while (releaseCursor < releaseTimes.length && releaseTimes[releaseCursor] <= click.t) {
      releaseCursor += 1;
    }
    if (releaseCursor < releaseTimes.length) {
      hits.push({ t: releaseTimes[releaseCursor], release: true, index });
      releaseCursor += 1;
    }
  });

  return hits.sort((a, b) => a.t - b.t);
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ±3% pitch and ±1.5 dB level per click, so repeated clicks don't sound robotic. */
function getClickVariation(index: number): { pitch: number; gain: number } {
  const random = mulberry32(index * 7919 + 17);
  return {
    pitch: 1 + (random() - 0.5) * 0.06,
    gain: Math.pow(10, ((random() - 0.5) * 3) / 20),
  };
}

function getNoiseBuffer(context: AudioContextLike): AudioBuffer {
  const sampleRate = context.sampleRate;
  const cached = NOISE_BUFFER_CACHE.get(sampleRate);
  if (cached) {
    return cached;
  }

  const random = mulberry32(1337);
  const length = Math.max(1, Math.ceil(sampleRate * NOISE_BUFFER_SECONDS));
  const buffer = context.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    channel[i] = random() * 2 - 1;
  }
  NOISE_BUFFER_CACHE.set(sampleRate, buffer);
  return buffer;
}

function disconnectLater(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) {
      node.disconnect();
    }
  };
}

function createDecayEnvelope(
  context: AudioContextLike,
  when: number,
  peak: number,
  tau: number,
  attack: number,
): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + attack);
  gain.gain.setTargetAtTime(0, when + attack, tau);
  return gain;
}

function scheduleNoiseLayer(
  context: AudioContextLike,
  destination: AudioNode,
  layer: NoiseLayer,
  when: number,
  gain: number,
  index: number,
): void {
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(layer.hp, when);
  highpass.Q.setValueAtTime(0.7, when);

  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(layer.lp, when);
  lowpass.Q.setValueAtTime(0.7, when);

  const envelope = createDecayEnvelope(context, when, layer.gain * gain, layer.tau, 0.0003);

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(envelope);
  envelope.connect(destination);
  disconnectLater(source, [highpass, lowpass, envelope]);

  // A different slice of the noise buffer per click keeps transients from being identical.
  const offset = (index * 0.0137) % (NOISE_BUFFER_SECONDS / 2);
  source.start(when, offset);
  source.stop(when + layer.tau * 8 + 0.01);
}

function scheduleModeLayer(
  context: AudioContextLike,
  destination: AudioNode,
  layer: ModeLayer,
  when: number,
  gain: number,
  pitch: number,
): void {
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(layer.f * pitch, when);
  if (layer.to) {
    oscillator.frequency.exponentialRampToValueAtTime(
      layer.to * pitch,
      when + (layer.sweep ?? layer.tau * 3),
    );
  }

  const envelope = createDecayEnvelope(
    context,
    when,
    layer.gain * gain,
    layer.tau,
    layer.attack ?? 0.0004,
  );

  oscillator.connect(envelope);
  envelope.connect(destination);
  disconnectLater(oscillator, [envelope]);

  oscillator.start(when);
  oscillator.stop(when + layer.tau * 8 + 0.02);
}

export function scheduleCursorClickSound(
  context: AudioContextLike,
  clickSound: CursorClickSound,
  volume: number,
  when: number,
  destination: AudioNode = context.destination,
  options: ClickSoundHitOptions = {},
): void {
  if (clickSound === 'none' || volume <= 0) {
    return;
  }

  const profile = CLICK_SOUND_PROFILES[clickSound];
  if (!profile) {
    return;
  }

  const isRelease = options.release === true;
  if (isRelease && !profile.release) {
    return;
  }

  const index = options.index ?? 0;
  const variation = getClickVariation(index);
  const releaseGain = isRelease && profile.release ? profile.release.gain : 1;
  const releasePitch = isRelease && profile.release ? profile.release.pitch : 1;
  const gain = Math.min(volume, 1) * profile.norm * variation.gain * releaseGain;
  const pitch = variation.pitch * releasePitch;

  for (const layer of profile.press) {
    if (layer.kind === 'noise') {
      scheduleNoiseLayer(context, destination, layer, when, gain, index);
    } else {
      scheduleModeLayer(context, destination, layer, when, gain, pitch);
    }
  }
}

async function getPreviewAudioContext(): Promise<AudioContext | null> {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    return null;
  }

  previewAudioContext ??= new window.AudioContext();
  if (previewAudioContext.state === 'suspended') {
    await previewAudioContext.resume().catch(() => undefined);
  }
  return previewAudioContext;
}

/** Plays one hit (press or release) right now; used by the editor preview. */
export async function playCursorClickSound(
  clickSound: CursorClickSound,
  volume: number,
  options: ClickSoundHitOptions = {},
): Promise<void> {
  if (clickSound === 'none' || volume <= 0) {
    return;
  }

  const context = await getPreviewAudioContext();
  if (!context) {
    return;
  }

  scheduleCursorClickSound(
    context,
    clickSound,
    volume,
    context.currentTime + 0.005,
    context.destination,
    options,
  );
}

/** Plays a full click (press, then release) to audition a sound from the widget. */
export async function auditionCursorClickSound(
  clickSound: CursorClickSound,
  volume: number,
): Promise<void> {
  if (clickSound === 'none' || volume <= 0) {
    return;
  }

  const context = await getPreviewAudioContext();
  if (!context) {
    return;
  }

  const index = previewClickIndex;
  previewClickIndex += 1;
  const when = context.currentTime + 0.005;
  scheduleCursorClickSound(context, clickSound, volume, when, context.destination, { index });
  scheduleCursorClickSound(
    context,
    clickSound,
    volume,
    when + PREVIEW_RELEASE_DELAY,
    context.destination,
    { index, release: true },
  );
}
