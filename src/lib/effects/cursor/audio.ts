import type { CursorClickSound } from '../../../store';
// Recorded mouse clicks. The renderer build embeds them as data URLs
// (assetsInlineLimit in electron.vite.config.mts): the packaged app loads its
// windows from file://, where fetch() can't read them. The dev server serves them by URL.
// Sources and licenses: src/assets/sounds/clicks/README.md.
import mousePressUrl from 'src/assets/sounds/clicks/mouse-press.wav';
import mouseReleaseUrl from 'src/assets/sounds/clicks/mouse-release.wav';
import mouse2PressUrl from 'src/assets/sounds/clicks/mouse-2-press.wav';
import mouse2ReleaseUrl from 'src/assets/sounds/clicks/mouse-2-release.wav';

export { CLICK_SOUND_OPTIONS, normalizeCursorClickSound } from './clickSoundOptions';

type AudioContextLike = AudioContext | OfflineAudioContext;

/**
 * Two kinds of click sound share one scheduling path, used by both the live
 * preview (AudioContext) and export (OfflineAudioContext):
 *
 * - Recorded (the mice): a press and a release recording, decoded once with
 *   loadCursorClickSound() and then played as buffer sources.
 * - Synthesized (trackpad, soft): a short filtered-noise transient plus a few
 *   exponentially decaying sine "modes" (the resonances of a switch or a
 *   trackpad body). Nothing to load.
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

type SynthClickSound = {
  kind: 'synth';
  /** Loudness-matching gain: every profile peaks at about -4 dBFS at volume 1. */
  norm: number;
  press: ClickSoundLayer[];
  /** Mouse-up: the press layers again, quieter and pitched up. */
  release: { gain: number; pitch: number };
};

type RecordedClickSound = {
  kind: 'recorded';
  /** Loudness-matching gain against the synthesized sounds. */
  norm: number;
  /** Data URLs of the press and release recordings. */
  press: string;
  release: string;
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

const CLICK_SOUND_PROFILES: Record<
  Exclude<CursorClickSound, 'none'>,
  SynthClickSound | RecordedClickSound
> = {
  // Norms bring a 4-clicks-a-second train to about -29 LUFS at volume 1, like trackpad and soft.
  mouse: { kind: 'recorded', norm: 0.596, press: mousePressUrl, release: mouseReleaseUrl },
  'mouse-2': { kind: 'recorded', norm: 0.767, press: mouse2PressUrl, release: mouse2ReleaseUrl },
  soft: {
    kind: 'synth',
    norm: 0.684,
    press: [
      { kind: 'noise', hp: 350, lp: 2600, tau: 0.0022, gain: 0.55 },
      { kind: 'mode', f: 1450, tau: 0.0045, gain: 0.22 },
      { kind: 'mode', f: 230, to: 170, tau: 0.01, gain: 0.45 },
    ],
    release: { gain: 0.32, pitch: 1.12 },
  },
  trackpad: {
    kind: 'synth',
    norm: 0.351,
    press: [
      { kind: 'mode', f: 270, to: 175, sweep: 0.02, tau: 0.011, gain: 0.85, attack: 0.0008 },
      { kind: 'noise', hp: 1600, lp: 7000, tau: 0.0013, gain: 0.32 },
      { kind: 'mode', f: 2150, tau: 0.0035, gain: 0.14 },
    ],
    release: { gain: 0.55, pitch: 1.18 },
  },
};

/** Gap between press and release when auditioning a sound from the widget. */
const PREVIEW_RELEASE_DELAY = 0.095;
/**
 * Shortest press-to-release gap that gets a release sound. Tap-to-click on a
 * trackpad reports mouse-up a few ms after mouse-down; playing the same click
 * twice that close together comb-filters it into a hollow, pitched zap instead
 * of a click. Real button presses take longer than this.
 */
const MIN_RELEASE_GAP_SECONDS = 0.04;
const NOISE_BUFFER_SECONDS = 0.08;
const NOISE_BUFFER_CACHE = new Map<number, AudioBuffer>();
/** Decoded recordings by data URL. AudioBuffers are not tied to the context that decoded them. */
const RECORDING_CACHE = new Map<string, AudioBuffer>();
const RECORDING_LOADS = new Map<string, Promise<AudioBuffer>>();
let previewAudioContext: AudioContext | null = null;
let previewClickIndex = 0;

/**
 * Turns click (mouse-down) events into sound hits: one press per click, plus a
 * release at the first mouse-up after it, when one was recorded and comes at
 * least MIN_RELEASE_GAP_SECONDS later. Hits are sorted
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
      const releaseTime = releaseTimes[releaseCursor];
      if (releaseTime - click.t >= MIN_RELEASE_GAP_SECONDS) {
        hits.push({ t: releaseTime, release: true, index });
      }
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

/**
 * Production builds inline the recordings as base64 data URLs; the Vite dev
 * server serves them by URL instead, so fetch those.
 */
async function readRecording(url: string): Promise<ArrayBuffer> {
  if (!url.startsWith('data:')) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load click sound ${url}: ${response.status}`);
    }
    return response.arrayBuffer();
  }
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function decodeRecording(context: BaseAudioContext, url: string): Promise<AudioBuffer> {
  let load = RECORDING_LOADS.get(url);
  if (!load) {
    load = readRecording(url)
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        RECORDING_CACHE.set(url, buffer);
        return buffer;
      });
    // A failed decode can be retried by the next caller.
    load.catch(() => RECORDING_LOADS.delete(url));
    RECORDING_LOADS.set(url, load);
  }
  return load;
}

/**
 * Decodes a recorded click sound's press and release so scheduleCursorClickSound()
 * can play them. Resolves immediately for synthesized sounds and for recordings
 * that are already decoded.
 */
export async function loadCursorClickSound(
  context: BaseAudioContext,
  clickSound: CursorClickSound,
): Promise<void> {
  if (clickSound === 'none') {
    return;
  }
  const profile = CLICK_SOUND_PROFILES[clickSound];
  if (profile?.kind !== 'recorded') {
    return;
  }
  await Promise.all([
    decodeRecording(context, profile.press),
    decodeRecording(context, profile.release),
  ]);
}

function scheduleRecording(
  context: AudioContextLike,
  destination: AudioNode,
  buffer: AudioBuffer,
  when: number,
  gain: number,
  rate: number,
): void {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(rate, when);

  const level = context.createGain();
  level.gain.setValueAtTime(gain, when);

  source.connect(level);
  level.connect(destination);
  disconnectLater(source, [level]);
  source.start(when);
}

/**
 * Schedules one hit (press or release). Recorded sounds play only once
 * loadCursorClickSound() has decoded them; until then this is a no-op.
 */
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
  const index = options.index ?? 0;
  const variation = getClickVariation(index);
  const level = Math.min(volume, 1) * profile.norm * variation.gain;

  if (profile.kind === 'recorded') {
    const buffer = RECORDING_CACHE.get(isRelease ? profile.release : profile.press);
    if (buffer) {
      scheduleRecording(context, destination, buffer, when, level, variation.pitch);
    }
    return;
  }

  const gain = level * (isRelease ? profile.release.gain : 1);
  const pitch = variation.pitch * (isRelease ? profile.release.pitch : 1);
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
  await loadCursorClickSound(context, clickSound);

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
  await loadCursorClickSound(context, clickSound);

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
