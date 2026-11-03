import type { CursorClickSound } from '../../../store';

type AudioContextLike = AudioContext | OfflineAudioContext;

type ClickSoundProfile = {
  noiseDuration: number;
  noiseGain: number;
  noiseFilterFrequency: number;
  noiseQ: number;
  highpassFrequency: number;
  toneType: OscillatorType;
  toneStartFrequency: number;
  toneEndFrequency: number;
  toneDuration: number;
  toneGain: number;
};

const CLICK_SOUND_PROFILES: Record<Exclude<CursorClickSound, 'none'>, ClickSoundProfile> = {
  'magic-mouse': {
    noiseDuration: 0.01,
    noiseGain: 0.12,
    noiseFilterFrequency: 5200,
    noiseQ: 4.5,
    highpassFrequency: 1800,
    toneType: 'triangle',
    toneStartFrequency: 1800,
    toneEndFrequency: 1260,
    toneDuration: 0.024,
    toneGain: 0.04,
  },
  'mx-master': {
    noiseDuration: 0.012,
    noiseGain: 0.16,
    noiseFilterFrequency: 3600,
    noiseQ: 3.3,
    highpassFrequency: 900,
    toneType: 'triangle',
    toneStartFrequency: 1180,
    toneEndFrequency: 720,
    toneDuration: 0.03,
    toneGain: 0.055,
  },
};

const NOISE_BUFFER_CACHE = new Map<number, AudioBuffer>();
let previewAudioContext: AudioContext | null = null;

function getNoiseBuffer(context: AudioContextLike): AudioBuffer {
  const sampleRate = context.sampleRate;
  const cached = NOISE_BUFFER_CACHE.get(sampleRate);
  if (cached) {
    return cached;
  }

  const length = Math.max(1, Math.ceil(sampleRate * 0.05));
  const buffer = context.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }
  NOISE_BUFFER_CACHE.set(sampleRate, buffer);
  return buffer;
}

function disconnectLater(source: AudioBufferSourceNode | OscillatorNode, nodes: AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) {
      node.disconnect();
    }
  };
}

function scheduleNoiseLayer(
  context: AudioContextLike,
  destination: AudioNode,
  profile: ClickSoundProfile,
  when: number,
  gainMultiplier: number,
): void {
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(profile.highpassFrequency, when);

  const bandpass = context.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(profile.noiseFilterFrequency, when);
  bandpass.Q.setValueAtTime(profile.noiseQ, when);

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.001, when);
  gain.gain.exponentialRampToValueAtTime(profile.noiseGain * gainMultiplier, when + 0.0015);
  gain.gain.exponentialRampToValueAtTime(0.001, when + profile.noiseDuration);

  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(destination);
  disconnectLater(source, [highpass, bandpass, gain]);

  source.start(when);
  source.stop(when + profile.noiseDuration + 0.01);
}

function scheduleToneLayer(
  context: AudioContextLike,
  destination: AudioNode,
  profile: ClickSoundProfile,
  when: number,
  gainMultiplier: number,
): void {
  const oscillator = context.createOscillator();
  oscillator.type = profile.toneType;
  oscillator.frequency.setValueAtTime(profile.toneStartFrequency, when);
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(profile.toneEndFrequency, 1),
    when + profile.toneDuration,
  );

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.001, when);
  gain.gain.exponentialRampToValueAtTime(profile.toneGain * gainMultiplier, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, when + profile.toneDuration);

  oscillator.connect(gain);
  gain.connect(destination);
  disconnectLater(oscillator, [gain]);

  oscillator.start(when);
  oscillator.stop(when + profile.toneDuration + 0.01);
}

export function scheduleCursorClickSound(
  context: AudioContextLike,
  clickSound: CursorClickSound,
  volume: number,
  when: number,
  destination: AudioNode = context.destination,
): void {
  if (clickSound === 'none' || volume <= 0) {
    return;
  }

  const profile = CLICK_SOUND_PROFILES[clickSound];
  const gainMultiplier = Math.max(0.001, Math.min(volume, 1));

  scheduleNoiseLayer(context, destination, profile, when, gainMultiplier);
  scheduleToneLayer(context, destination, profile, when, gainMultiplier);
}

async function getPreviewAudioContext(): Promise<AudioContext | null> {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    return null;
  }

  previewAudioContext ??= new window.AudioContext();
  if (previewAudioContext.state === 'suspended') {
    await previewAudioContext.resume().catch(() => undefined);
  }
  return previewAudioContext.state === 'running' ? previewAudioContext : previewAudioContext;
}

export async function playCursorClickSound(
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

  const when = context.currentTime + 0.005;
  scheduleCursorClickSound(context, clickSound, volume, when);
}
