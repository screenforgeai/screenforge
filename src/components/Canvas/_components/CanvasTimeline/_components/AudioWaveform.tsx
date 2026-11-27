import { useEffect, useMemo, useState } from 'react';

interface AudioWaveformProps {
  /** The file whose audio track is drawn. */
  audioPath: string;
  sourceStart: number;
  sourceEnd: number;
  selected: boolean;
}

interface WaveformData {
  peaks: number[];
  duration: number;
}

const BARS_COUNT = 90;
const MIN_BAR_HEIGHT_PERCENT = 3;
const waveformCache = new Map<string, Promise<WaveformData | null>>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Peaks come from the main process, which decodes the audio with ffmpeg: the
 * source is often the recording itself (mic merged in), and fetching and
 * decoding an hour of it here took several GB and could crash the editor.
 */
function loadWaveform(audioPath: string): Promise<WaveformData | null> {
  const cached = waveformCache.get(audioPath);
  if (cached) {
    return cached;
  }

  const promise = window.screenforge
    .getAudioPeaks(audioPath)
    .then((result) =>
      result && result.peaks.length > 0 ? { peaks: result.peaks, duration: result.duration } : null,
    )
    .catch((error: unknown) => {
      waveformCache.delete(audioPath);
      throw error;
    });

  waveformCache.set(audioPath, promise);
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
  audioPath,
  sourceStart,
  sourceEnd,
  selected,
}: AudioWaveformProps) => {
  const [waveform, setWaveform] = useState<WaveformData | null>(null);

  useEffect(() => {
    let mounted = true;

    loadWaveform(audioPath)
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
  }, [audioPath]);

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
