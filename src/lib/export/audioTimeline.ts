import { createScreenforgeFileUrl } from '../screenforge-url';
import type { RecordingResult, ProjectCursorSettings } from '../../types/index';
import type { MediaSegment } from '../../types/timeline';
import type { CursorData } from '../effects/cursor';
import type { MusicClip } from '../timeline';
import { buildClickSoundHits, scheduleCursorClickSound } from '../effects/cursor/audio';
import { isMediaTrackEnabled } from '../helpers/segments';
import { resolveAudioDecodeCandidates } from '../recording/audioSource';

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Export rendering cancelled');
  }
}

/**
 * WSOLA (Waveform Similarity Overlap-Add) time-scale modification.
 * Produces exactly `outputLength` samples at the given speed while preserving
 * pitch — matching HTMLMediaElement.playbackRate pitch-correction.
 *
 * Unlike plain OLA, WSOLA searches a small neighbourhood around the nominal
 * input position to find the best-phase-matching frame before adding it to
 * the output. This eliminates the "phasey/robotic" artefact that plain OLA
 * produces for voiced speech and music, because consecutive output frames
 * always overlap in a region of high waveform similarity.
 */
function timeStretchChannel(
  input: Float32Array,
  speed: number,
  outputLength: number,
): Float32Array {
  const WINDOW = 1024;
  const HOP_OUT = WINDOW >> 1; // 512 — 50 % overlap
  const HOP_IN = Math.max(1, Math.round(HOP_OUT * speed));
  // Search radius: up to half of HOP_IN, capped at 256 (~5ms at 48 kHz) for performance.
  // 256 samples covers one period of ~188 Hz (male speech fundamental), giving the
  // correlation search a realistic chance of finding a phase-aligned frame.
  const SEARCH = Math.min(Math.round(HOP_IN >> 1), 256);

  const output = new Float32Array(outputLength);
  const weight = new Float32Array(outputLength);

  const hann = Float32Array.from(
    { length: WINDOW },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW),
  );

  let inOff = 0;
  let outOff = 0;
  let prevOff = -1; // actual input offset used for the previous frame

  while (outOff < outputLength) {
    // WSOLA: find the input position within [inOff-SEARCH, inOff+SEARCH] whose
    // head (first HOP_OUT samples) best correlates with the tail of the
    // previous frame (its last HOP_OUT samples). Skip the search for the very
    // first frame — there is no previous frame to correlate with.
    let bestOff = Math.max(0, inOff);
    if (prevOff >= 0 && SEARCH > 0) {
      let bestCorr = -Infinity;
      const lo = Math.max(0, inOff - SEARCH);
      const hi = inOff + SEARCH;
      for (let d = lo; d <= hi; d++) {
        let corr = 0;
        for (let k = 0; k < HOP_OUT; k++) {
          const p = prevOff + HOP_OUT + k < input.length ? input[prevOff + HOP_OUT + k] : 0;
          const n = d + k < input.length ? input[d + k] : 0;
          corr += p * n;
        }
        if (corr > bestCorr) {
          bestCorr = corr;
          bestOff = d;
        }
      }
    }

    for (let i = 0; i < WINDOW; i++) {
      const o = outOff + i;
      if (o >= outputLength) {
        break;
      }
      const w = hann[i];
      const s = bestOff + i < input.length ? input[bestOff + i] : 0;
      output[o] += s * w;
      weight[o] += w;
    }

    prevOff = bestOff;
    inOff += HOP_IN; // advance nominal position by the speed-scaled hop
    outOff += HOP_OUT;
  }

  for (let i = 0; i < outputLength; i++) {
    if (weight[i] > 1e-8) {
      output[i] /= weight[i];
    }
  }
  return output;
}

function encodeWav(audioBuffer: AudioBuffer, signal?: AbortSignal): ArrayBuffer {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + length * blockAlign);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * blockAlign, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * blockAlign, true);

  let offset = 44;
  const channelData = Array.from({ length: channelCount }, (_, index) =>
    audioBuffer.getChannelData(index),
  );

  for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
    if (sampleIndex % sampleRate === 0) {
      assertNotAborted(signal);
    }

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channelIndex][sampleIndex] ?? 0));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return buffer;
}

export interface RenderTimelineAudioOptions {
  recording: RecordingResult;
  orderedSegments: MediaSegment[];
  duration: number;
  includeAudio: boolean;
  cursor: Pick<ProjectCursorSettings, 'clickSound' | 'clickSoundVolume'>;
  clickEvents: CursorData['clickEvents'];
  /** Mouse-down/up events; mouse-ups add a release sound to each click. */
  pressEvents?: CursorData['pressEvents'];
  musicClips?: MusicClip[];
  signal?: AbortSignal;
}

export async function renderTimelineAudio(
  options: RenderTimelineAudioOptions,
): Promise<ArrayBuffer | undefined> {
  const {
    recording,
    orderedSegments,
    duration,
    includeAudio,
    cursor,
    clickEvents,
    pressEvents,
    musicClips,
    signal,
  } = options;

  if (!includeAudio) {
    return undefined;
  }

  assertNotAborted(signal);

  const activeAudioSegments = orderedSegments.filter((segment) =>
    isMediaTrackEnabled(segment, 'audio'),
  );
  const hasCursorClickAudio =
    cursor.clickSound !== 'none' && cursor.clickSoundVolume > 0 && clickEvents.length > 0;
  const hasBackgroundMusic = Boolean(musicClips?.some((c) => c.filePath));

  if (activeAudioSegments.length === 0 && !hasCursorClickAudio && !hasBackgroundMusic) {
    return undefined;
  }

  const candidatePaths = resolveAudioDecodeCandidates(recording);

  let decoded: AudioBuffer | null = null;
  if (activeAudioSegments.length > 0) {
    for (const audioSourcePath of candidatePaths) {
      assertNotAborted(signal);
      try {
        const response = await fetch(createScreenforgeFileUrl(audioSourcePath), { signal });
        if (!response.ok) {
          continue;
        }

        assertNotAborted(signal);
        const sourceBuffer = await response.arrayBuffer();
        const decodeContext = new AudioContext();
        try {
          assertNotAborted(signal);
          decoded = await decodeContext.decodeAudioData(sourceBuffer.slice(0));
          assertNotAborted(signal);
          if (decoded) {
            break;
          }
        } finally {
          await decodeContext.close().catch(() => undefined);
        }
      } catch {
        assertNotAborted(signal);
        // Ignore undecodable inputs and keep looking for another viable audio source.
      }
    }
  }

  if (!decoded && !hasCursorClickAudio && !hasBackgroundMusic) {
    return undefined;
  }

  const outputChannels = decoded ? Math.max(1, Math.min(decoded.numberOfChannels, 2)) : 2;
  const sampleRate = decoded?.sampleRate ?? 48_000;
  const frameCount = Math.max(1, Math.ceil(duration * sampleRate));
  const offline = new OfflineAudioContext(outputChannels, frameCount, sampleRate);

  if (decoded) {
    for (const segment of activeAudioSegments) {
      const speed = segment.speed ?? 1;
      const timelineDuration = Math.max(0, segment.timelineEnd - segment.timelineStart);
      if (timelineDuration <= 0) {
        continue;
      }

      // clampMediaSegmentsToSourceDuration (video pipeline) sets
      // sourceEnd = sourceStart + timelineDuration regardless of speed, so
      // segment.sourceEnd - segment.sourceStart == timelineDuration for sped-up
      // clips. Recover the true source duration from the timeline duration × speed.
      const trueSourceDuration = timelineDuration * speed;

      if (Math.abs(speed - 1) < 0.001) {
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start(
          Math.max(0, segment.timelineStart),
          Math.max(0, segment.sourceStart),
          trueSourceDuration,
        );
      } else {
        // Apply OLA time-stretch so duration changes without pitch shift,
        // matching the behaviour of HTMLMediaElement.playbackRate in preview.
        const srcStart = Math.round(Math.max(0, segment.sourceStart) * sampleRate);
        const srcLen = Math.min(
          Math.round(trueSourceDuration * sampleRate),
          decoded.length - srcStart,
        );
        const outLen = Math.max(1, Math.round(timelineDuration * sampleRate));
        const numCh = Math.min(decoded.numberOfChannels, outputChannels);
        const stretchedBuf = offline.createBuffer(numCh, outLen, sampleRate);

        for (let ch = 0; ch < numCh; ch++) {
          const slice = decoded.getChannelData(ch).subarray(srcStart, srcStart + srcLen);
          const stretched = timeStretchChannel(slice, speed, outLen);
          stretchedBuf.getChannelData(ch).set(stretched);
        }

        const src = offline.createBufferSource();
        src.buffer = stretchedBuf;
        src.connect(offline.destination);
        src.start(Math.max(0, segment.timelineStart));
      }
    }
  }

  if (hasCursorClickAudio) {
    for (const hit of buildClickSoundHits(clickEvents, pressEvents)) {
      if (hit.t < 0 || hit.t > duration) {
        continue;
      }

      scheduleCursorClickSound(
        offline,
        cursor.clickSound,
        cursor.clickSoundVolume,
        Math.max(0, hit.t),
        offline.destination,
        { release: hit.release, index: hit.index },
      );
    }
  }

  if (musicClips?.length) {
    for (const musicClip of musicClips) {
      if (!musicClip.filePath) {
        continue;
      }
      try {
        const musicUrl = createScreenforgeFileUrl(musicClip.filePath);
        const musicResponse = await fetch(musicUrl, { signal });
        if (!musicResponse.ok) {
          continue;
        }
        assertNotAborted(signal);
        const musicBuffer = await musicResponse.arrayBuffer();
        const decodeContext = new AudioContext();
        let decodedMusic: AudioBuffer | null = null;
        try {
          assertNotAborted(signal);
          decodedMusic = await decodeContext.decodeAudioData(musicBuffer.slice(0));
        } finally {
          await decodeContext.close().catch(() => undefined);
        }
        if (!decodedMusic) {
          continue;
        }
        assertNotAborted(signal);
        const musicGain = offline.createGain();
        musicGain.gain.setValueAtTime(Math.max(0.001, Math.min(1, musicClip.volume)), 0);
        musicGain.connect(offline.destination);

        const clipStart = musicClip.timelineStart;
        const clipEnd = musicClip.fitToVideo ? duration : musicClip.timelineEnd;
        const audioOffset = Math.max(0, musicClip.startTime);
        const audioDuration = decodedMusic.duration - audioOffset;

        // Always loop: schedule repeated segments if the clip is longer than the audio
        let timelinePos = clipStart;
        while (timelinePos < clipEnd && audioDuration > 0) {
          const source = offline.createBufferSource();
          source.buffer = decodedMusic;
          const segLen = Math.min(audioDuration, clipEnd - timelinePos);
          source.connect(musicGain);
          source.start(timelinePos, audioOffset, segLen);
          timelinePos += segLen;
        }
      } catch {
        assertNotAborted(signal);
      }
    }
  }

  assertNotAborted(signal);
  const rendered = await offline.startRendering();
  assertNotAborted(signal);
  return encodeWav(rendered, signal);
}
