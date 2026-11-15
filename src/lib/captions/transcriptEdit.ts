/**
 * Edit-by-transcript: turn transcript words into timeline cuts.
 *
 * Caption words carry SOURCE times (seconds into the recording file; Whisper
 * transcribes the whole file and captions render against video.currentTime),
 * while cuts happen on the TIMELINE. Everything here maps words through the
 * media segments, so a transcript keeps working on a video that already has cuts,
 * speed changes or reordered clips. All of it is pure and runs on device.
 */
import type { CaptionSegment, RecordingResult } from '../../types';
import type { MediaSegment } from '../../types/timeline';
import {
  normalizeTimeRanges,
  resolveTimelineCuts,
  sortMediaSegments,
  sumTimeRanges,
  type TimeRange,
} from '../helpers/segments';
import { isFillerWord } from './fillers';

export type { TimeRange } from '../helpers/segments';
export { sumTimeRanges as sumRanges } from '../helpers/segments';

/** Pauses at least this long (seconds) count as silences by default. */
export const DEFAULT_MIN_SILENCE = 1;
/** Pause left on each side of a trimmed silence, so speech doesn't run together. */
export const DEFAULT_SILENCE_PAD = 0.2;

export interface TranscriptWord {
  /** Stable id for this word: `${segmentId}:${index}`. */
  key: string;
  segmentId: string;
  index: number;
  word: string;
  /** Source time, seconds. */
  start: number;
  end: number;
  /** From a hand-edited line, so its timings are estimates. */
  edited: boolean;
}

export const getWordKey = (segmentId: string, index: number) => `${segmentId}:${index}`;

/** Every transcript word in source order. */
export function flattenTranscript(segments: readonly CaptionSegment[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const seg of segments) {
    seg.words.forEach((w, index) => {
      words.push({
        key: getWordKey(seg.id, index),
        segmentId: seg.id,
        index,
        word: w.word,
        start: w.start,
        end: w.end,
        edited: seg.edited === true,
      });
    });
  }
  // Stable sort keeps transcript order for words with equal start times.
  return words.sort((a, b) => a.start - b.start);
}

/** The keys of every word from `fromKey` to `toKey` inclusive, in transcript order. */
export function getWordRangeKeys(
  words: readonly TranscriptWord[],
  fromKey: string,
  toKey: string,
): string[] {
  const to = words.findIndex((w) => w.key === toKey);
  if (to === -1) {
    return [];
  }
  const from = words.findIndex((w) => w.key === fromKey);
  if (from === -1) {
    return [toKey];
  }
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return words.slice(lo, hi + 1).map((w) => w.key);
}

/** Where a source range plays on the timeline (one range per clip that plays part of it). */
export function mapSourceRangeToTimeline(
  mediaSegments: MediaSegment[],
  range: TimeRange,
): TimeRange[] {
  const out: TimeRange[] = [];
  for (const seg of sortMediaSegments(mediaSegments)) {
    const start = Math.max(range.start, seg.sourceStart);
    const end = Math.min(range.end, seg.sourceEnd);
    if (end <= start) {
      continue;
    }
    const speed = seg.speed ?? 1;
    out.push({
      start: seg.timelineStart + (start - seg.sourceStart) / speed,
      end: seg.timelineStart + (end - seg.sourceStart) / speed,
    });
  }
  return out;
}

function mapSourceTimeToTimeline(mediaSegments: MediaSegment[], time: number): number | null {
  for (const seg of sortMediaSegments(mediaSegments)) {
    if (time >= seg.sourceStart && time <= seg.sourceEnd) {
      return seg.timelineStart + (time - seg.sourceStart) / (seg.speed ?? 1);
    }
  }
  return null;
}

/** True while the middle of the word still plays somewhere on the timeline. */
export function isWordOnTimeline(
  mediaSegments: MediaSegment[],
  word: { start: number; end: number },
): boolean {
  return mapSourceTimeToTimeline(mediaSegments, (word.start + word.end) / 2) !== null;
}

/** The timeline span a word still plays across, or null when it was cut. */
export function getWordTimelineSpan(
  mediaSegments: MediaSegment[],
  word: { start: number; end: number },
): TimeRange | null {
  if (!isWordOnTimeline(mediaSegments, word)) {
    return null;
  }
  const parts = mapSourceRangeToTimeline(mediaSegments, word);
  if (parts.length === 0) {
    return null;
  }
  return {
    start: Math.min(...parts.map((p) => p.start)),
    end: Math.max(...parts.map((p) => p.end)),
  };
}

/**
 * Timeline ranges that cut the selected words. Words next to each other (among
 * those still on the timeline) are cut as one range, so the pauses between them
 * go too; a lone word is cut at its own timing.
 */
export function getWordCutRanges(
  words: readonly TranscriptWord[],
  mediaSegments: MediaSegment[],
  keys: ReadonlySet<string>,
): TimeRange[] {
  const sourceRuns: TimeRange[] = [];
  let run: TimeRange | null = null;
  for (const w of words) {
    if (!isWordOnTimeline(mediaSegments, w)) {
      continue;
    }
    if (!keys.has(w.key)) {
      run = null;
      continue;
    }
    if (run) {
      run.end = Math.max(run.end, w.end);
    } else {
      run = { start: w.start, end: w.end };
      sourceRuns.push(run);
    }
  }
  return normalizeTimeRanges(sourceRuns.flatMap((r) => mapSourceRangeToTimeline(mediaSegments, r)));
}

export interface CleanupOptions {
  /** Transcript language code ("en", "de"…), for the filler list. */
  language: string;
  fillers: boolean;
  silences: boolean;
  /** Pauses at least this long (seconds) are trimmed. */
  minSilence: number;
  /** Pause kept on each side of a trimmed silence (seconds). */
  silencePad: number;
  /** Source times of clicks, key presses and scrolls; a pause with one in it is kept. */
  activityTimes?: readonly number[];
}

export interface CleanupCut {
  id: string;
  kind: 'filler' | 'silence';
  /** The filler word, or for a silence the word right after the pause. */
  wordKey: string;
  /** Timeline ranges this cut removes. */
  ranges: TimeRange[];
  duration: number;
}

export interface CleanupPlan {
  cuts: CleanupCut[];
  /** Every cut merged and fitted to the clips — what applying removes. */
  ranges: TimeRange[];
  totalDuration: number;
}

/**
 * Finds filler words and long pauses to cut. Only words still on the timeline
 * count, and pauses are measured on the timeline, so earlier cuts are respected.
 */
export function planCleanup(
  captionSegments: readonly CaptionSegment[],
  mediaSegments: MediaSegment[],
  options: CleanupOptions,
): CleanupPlan {
  const cuts: CleanupCut[] = [];
  const onTimeline = flattenTranscript(captionSegments)
    .map((word) => ({ word, span: getWordTimelineSpan(mediaSegments, word) }))
    .filter((w): w is { word: TranscriptWord; span: TimeRange } => w.span !== null)
    .sort((a, b) => a.span.start - b.span.start);

  if (options.fillers) {
    for (const { word } of onTimeline) {
      if (word.edited || !isFillerWord(word.word, options.language)) {
        continue;
      }
      const ranges = mapSourceRangeToTimeline(mediaSegments, word);
      cuts.push({
        id: `filler:${word.key}`,
        kind: 'filler',
        wordKey: word.key,
        ranges,
        duration: sumTimeRanges(ranges),
      });
    }
  }

  if (options.silences) {
    const activity = (options.activityTimes ?? [])
      .map((t) => mapSourceTimeToTimeline(mediaSegments, t))
      .filter((t): t is number => t !== null);
    for (let i = 1; i < onTimeline.length; i += 1) {
      const gapStart = onTimeline[i - 1].span.end;
      const gapEnd = onTimeline[i].span.start;
      if (gapEnd - gapStart < options.minSilence) {
        continue;
      }
      if (activity.some((t) => t > gapStart && t < gapEnd)) {
        continue;
      }
      const start = gapStart + options.silencePad;
      const end = gapEnd - options.silencePad;
      if (end <= start) {
        continue;
      }
      const { word } = onTimeline[i];
      cuts.push({
        id: `silence:${word.key}`,
        kind: 'silence',
        wordKey: word.key,
        ranges: [{ start, end }],
        duration: end - start,
      });
    }
  }

  const ranges = resolveTimelineCuts(
    mediaSegments,
    cuts.flatMap((c) => c.ranges),
  );
  return { cuts, ranges, totalDuration: sumTimeRanges(ranges) };
}

/** Source times (seconds) of clicks, key presses and scrolls in a recording. */
export function getActivityTimes(recording: RecordingResult | null | undefined): number[] {
  if (!recording?.mouseData) {
    return [];
  }
  return recording.mouseData
    .filter((e) => e.type === 'mousedown' || e.type === 'keydown' || e.type === 'scroll')
    .map((e) => (e.timestamp - recording.startTime) / 1000);
}
