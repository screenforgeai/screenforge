import { useEffect, useMemo, useState } from 'react';

interface AudioWaveformProps {
  audioSrc: string;
  sourceStart: number;
  sourceEnd: number;
  selected: boolean;
}

interface WaveformData {
  peaks: number[];
  duration: number;
}

const BARS_COUNT = 90;
const PEAKS_MAX_LENGTH = 4096;
const MIN_BAR_HEIGHT_PERCENT = 3;
const waveformCache = new Map<string, Promise<WaveformData>>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toChannelPeaks(rawPeaks: number[] | number[][]): number[] {
  if (!Array.isArray(rawPeaks[0])) {
    return (rawPeaks as number[]).map((value) => Math.abs(value));
  }

  const peaks = rawPeaks as number[][];
  return peaks[0].map((value) => Math.abs(value));
}

async function loadWaveform(audioSrc: string): Promise<WaveformData> {
  const cached = waveformCache.get(audioSrc);
  if (cached) {
    return cached;
  }

  const promise = (async (): Promise<WaveformData> => {
    const response = await fetch(audioSrc);
    if (!response.ok) {
      throw new Error(`Unable to load audio file: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new AudioContext();
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const rawPeaks: number[][] = [];
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
        const channelData = audioBuffer.getChannelData(channel);
        const step = Math.max(1, Math.floor(channelData.length / PEAKS_MAX_LENGTH));
        const channelPeaks = Array.from({ length: PEAKS_MAX_LENGTH }, (_, idx) => {
          const from = idx * step;
          const to = Math.min(channelData.length, from + step);
          let max = 0;
          for (let i = from; i < to; i += 1) {
            max = Math.max(max, Math.abs(channelData[i]));
          }
          return max;
        });
        rawPeaks.push(channelPeaks);
      }

      const peaks = toChannelPeaks(rawPeaks);
      return {
        peaks: peaks.length > 0 ? peaks : [0],
        duration: audioBuffer.duration || 0,
      };
    } finally {
      await audioContext.close().catch(() => undefined);
    }
  })().catch((error) => {
    waveformCache.delete(audioSrc);
    throw error;
  });

  waveformCache.set(audioSrc, promise);
  return promise;
}

function getVisibleBars(
  waveform: WaveformData | null,
  sourceStart: number,
  sourceEnd: number,
): number[] {
  if (!waveform) {
    return Array.from({ length: BARS_COUNT }, (_, idx) => (idx % 3 === 0 ? 28 : 18));
  }

  const totalDuration = waveform.duration > 0 ? waveform.duration : Math.max(sourceEnd, 0.001);
  const startRatio = clamp(sourceStart / totalDuration, 0, 1);
  const endRatio = clamp(sourceEnd / totalDuration, 0, 1);

  const startIndex = Math.floor(startRatio * (waveform.peaks.length - 1));
  const endIndex = Math.max(startIndex + 1, Math.ceil(endRatio * (waveform.peaks.length - 1)));
  const clipPeaks = waveform.peaks.slice(startIndex, endIndex + 1);
  if (clipPeaks.length === 0) {
    return Array.from({ length: BARS_COUNT }, () => MIN_BAR_HEIGHT_PERCENT);
  }

  // Normalise against the loudest peak in the visible range so the waveform
  // always fills the clip height rather than staying flat for quiet audio.
  let globalMax = 0.001;
  for (const p of clipPeaks) {
    if (p > globalMax) {
      globalMax = p;
    }
  }

  return Array.from({ length: BARS_COUNT }, (_, idx) => {
    const bucketStart = Math.floor((idx / BARS_COUNT) * clipPeaks.length);
    const bucketEnd = Math.max(
      bucketStart + 1,
      Math.floor(((idx + 1) / BARS_COUNT) * clipPeaks.length),
    );
    let maxValue = 0;
    for (let i = bucketStart; i < bucketEnd; i += 1) {
      maxValue = Math.max(maxValue, Math.abs(clipPeaks[i]));
    }
    return clamp((maxValue / globalMax) * 90, MIN_BAR_HEIGHT_PERCENT, 90);
  });
}

export const AudioWaveform = ({
  audioSrc,
  sourceStart,
  sourceEnd,
  selected,
}: AudioWaveformProps) => {
  const [waveform, setWaveform] = useState<WaveformData | null>(null);

  useEffect(() => {
    let mounted = true;

    loadWaveform(audioSrc)
      .then((nextWaveform) => {
        if (mounted) {
          setWaveform(nextWaveform);
        }
      })
      .catch(() => {
        if (mounted) {
          setWaveform(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, [audioSrc]);

  const bars = useMemo(
    () => getVisibleBars(waveform, sourceStart, sourceEnd),
    [sourceEnd, sourceStart, waveform],
  );

  const barColor = selected ? 'rgba(4, 22, 20, 0.92)' : 'rgba(3, 18, 16, 0.88)';

  return (
    <div className="pointer-events-none absolute inset-x-1.5 bottom-1 top-1 z-[1] flex items-center gap-px">
      {bars.map((height, idx) => (
        <span
          key={idx}
          className="block flex-1"
          style={{
            height: `${height}%`,
            background: barColor,
          }}
        />
      ))}
    </div>
  );
};
