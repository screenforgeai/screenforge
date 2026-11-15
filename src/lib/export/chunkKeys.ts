/**
 * Content keys for export chunks.
 *
 * A chunk's key must change whenever anything that can affect its pixels
 * changes, and should stay the same when an edit only touches other parts of
 * the timeline. The render state is split automatically:
 *
 * - Timed lists — arrays whose items carry time fields (zoom, text, mask,
 *   motion, camera and caption clips, media segments, analysed cursor and
 *   keyboard events). Each chunk only hashes the items that overlap its
 *   window, plus the last item before the window (the "carry-in": a parked
 *   cursor or an idle timer depends on the last event before the chunk).
 * - Everything else (styles, settings, the export target, the renderer
 *   version) is hashed once and shared by every chunk, so a global change
 *   refreshes every chunk.
 *
 * Timeline data uses two time bases: cursor events and zoom are evaluated in
 * source time, frame fades, motion and keyboard events in timeline time. An
 * item is included when it overlaps the chunk's window in either base, which
 * can only include too much, never too little.
 */
import type { MediaSegment } from '../../types/timeline';
import type { ExportChunk } from './chunkPlan';

type Interval = [number, number];

export interface ChunkKeyInput {
  /** Bumped when the renderer or the chunk format changes. */
  version: string;
  /** Format, size, fps, quality — anything the encoder output depends on. */
  target: unknown;
  /** Every piece of render state, timed or not. Split automatically. */
  state: Record<string, unknown>;
  /** Playable segments, to map each chunk's window into source time. */
  segments: MediaSegment[];
  chunks: ExportChunk[];
  fps: number;
  /** How far before a chunk timed data can still affect it (≥ warm-up). */
  lookbackSeconds: number;
  /** How far after a chunk timed data can already affect it. */
  lookaheadSeconds: number;
  /**
   * Values derived for the chunk's own frames, for state whose effect is not
   * local in time (e.g. motion poses that carry from earlier clips).
   */
  perChunk?: (chunk: ExportChunk) => unknown;
}

// ── Hashing ─────────────────────────────────────────────────────────────────

/** 128-bit non-cryptographic string hash (cyrb128, public domain). */
export function hash128(input: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i += 1) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Deterministic JSON: sorted keys, Maps as sorted entries, no functions. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([k, v]) => [String(k), v] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    // Binary data is never part of render state; hash its size only.
    return JSON.stringify(`binary:${(value as ArrayBuffer).byteLength}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined && typeof record[k] !== 'function')
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

// ── Timed data ──────────────────────────────────────────────────────────────

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Time extents of an item, in whichever bases it carries; null if untimed. */
export function timeExtents(item: unknown): Interval[] | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }
  const r = item as Record<string, unknown>;
  const out: Interval[] = [];
  if (num(r.timelineStart) && num(r.timelineEnd)) {
    out.push([r.timelineStart, r.timelineEnd]);
  }
  if (num(r.sourceStart) && num(r.sourceEnd)) {
    out.push([r.sourceStart, r.sourceEnd]);
  }
  if (num(r.start) && num(r.end)) {
    out.push([r.start, r.end]);
  }
  if (num(r.startTime) && num(r.endTime)) {
    out.push([r.startTime, r.endTime]);
  }
  if (num(r.t)) {
    out.push([r.t, r.t]);
  }
  return out.length > 0 ? out : null;
}

interface TimedList {
  path: string;
  items: unknown[];
  extents: Interval[][];
}

const TIMED_PLACEHOLDER = '__timed__';

/**
 * Pulls every array whose items are all timed out of `value`, replacing it
 * with a placeholder. Arrays with any untimed item stay in the global part.
 */
export function splitTimedLists(
  value: unknown,
  path = '',
  lists: TimedList[] = [],
): { global: unknown; lists: TimedList[] } {
  if (Array.isArray(value)) {
    if (value.length > 0) {
      const extents = value.map(timeExtents);
      if (extents.every((e) => e !== null)) {
        lists.push({ path, items: value, extents: extents as Interval[][] });
        return { global: TIMED_PLACEHOLDER, lists };
      }
    }
    return {
      global: value.map((item, i) => splitTimedLists(item, `${path}[${i}]`, lists).global),
      lists,
    };
  }
  if (value instanceof Map) {
    const record: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      record[String(k)] = v;
    }
    return splitTimedLists(record, path, lists);
  }
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = splitTimedLists(v, path ? `${path}.${k}` : k, lists).global;
    }
    return { global: out, lists };
  }
  return { global: value, lists };
}

function overlaps(a: Interval, b: Interval): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** The chunk's window in timeline time plus the source ranges it samples. */
export function chunkWindows(
  startTime: number,
  endTime: number,
  segments: MediaSegment[],
): Interval[] {
  const windows: Interval[] = [[startTime, endTime]];
  for (const segment of segments) {
    const from = Math.max(startTime, segment.timelineStart);
    const to = Math.min(endTime, segment.timelineEnd);
    if (from > to) {
      continue;
    }
    const speed = segment.speed ?? 1;
    windows.push([
      segment.sourceStart + (from - segment.timelineStart) * speed,
      segment.sourceStart + (to - segment.timelineStart) * speed,
    ]);
  }
  return windows;
}

function isInstant(extents: Interval[]): boolean {
  return extents.every((e) => e[0] === e[1]);
}

/**
 * Items overlapping any window, plus — for instant events such as cursor
 * moves — the last event before each window, whose state carries into it.
 * Clips need no carry-in: what they do after their end is covered by the
 * look-back part of the window.
 */
export function selectForWindows(list: TimedList, windows: Interval[]): unknown[] {
  // Media segments label both their ranges, so match timeline against the
  // timeline window and source against the source windows only.
  if (list.items.every(isMediaSegment)) {
    const [timelineWindow, ...sourceWindows] = windows;
    return (list.items as MediaSegment[]).filter(
      (segment) =>
        overlaps([segment.timelineStart, segment.timelineEnd], timelineWindow) ||
        sourceWindows.some((w) => overlaps([segment.sourceStart, segment.sourceEnd], w)),
    );
  }
  const selected = new Set<number>();
  for (const window of windows) {
    let carryIndex = -1;
    let carryEnd = -Infinity;
    list.extents.forEach((extents, i) => {
      if (extents.some((e) => overlaps(e, window))) {
        selected.add(i);
        return;
      }
      if (!isInstant(extents)) {
        return;
      }
      for (const e of extents) {
        if (e[1] < window[0] && e[1] >= carryEnd) {
          carryEnd = e[1];
          carryIndex = i;
        }
      }
    });
    if (carryIndex >= 0) {
      selected.add(carryIndex);
    }
  }
  return [...selected].sort((a, b) => a - b).map((i) => list.items[i]);
}

function isMediaSegment(item: unknown): item is MediaSegment {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const r = item as Record<string, unknown>;
  return num(r.timelineStart) && num(r.timelineEnd) && num(r.sourceStart) && num(r.sourceEnd);
}

/**
 * What a media segment contributes to one chunk: how it maps timeline time to
 * source time, plus its edges (and their transitions) only where they fall
 * inside the chunk's window. A cut later in the segment then leaves earlier
 * chunks' keys alone. Ids are dropped: splitting a segment renames both
 * halves, and the only thing ids affect on screen — motion clips pinned to a
 * segment — is keyed by the motion the renderer resolves (see `perChunk`).
 */
export function segmentForWindow(segment: MediaSegment, window: Interval): unknown {
  const other: Record<string, unknown> = { ...(segment as unknown as Record<string, unknown>) };
  for (const field of [
    'id',
    'timelineStart',
    'timelineEnd',
    'sourceStart',
    'sourceEnd',
    'transitionIn',
    'transitionOut',
  ]) {
    delete other[field];
  }
  const speed = segment.speed ?? 1;
  const startInside = segment.timelineStart >= window[0];
  const endInside = segment.timelineEnd <= window[1];
  return {
    ...other,
    speed,
    sourceOffset: segment.sourceStart - segment.timelineStart * speed,
    start: startInside ? segment.timelineStart : null,
    end: endInside ? segment.timelineEnd : null,
    transitionIn: startInside ? (segment.transitionIn ?? null) : null,
    transitionOut: endInside ? (segment.transitionOut ?? null) : null,
  };
}

export function computeChunkKeys(input: ChunkKeyInput): string[] {
  const { global, lists } = splitTimedLists(input.state);
  const globalHash = hash128(
    stableStringify({ version: input.version, target: input.target, global }),
  );
  const fps = Math.max(1, input.fps);
  return input.chunks.map((chunk) => {
    const windows = chunkWindows(
      chunk.startFrame / fps - input.lookbackSeconds,
      chunk.endFrame / fps + input.lookaheadSeconds,
      input.segments,
    );
    const windowed: Record<string, unknown[]> = {};
    for (const list of lists) {
      windowed[list.path] = selectForWindows(list, windows).map((item) =>
        isMediaSegment(item) ? segmentForWindow(item, windows[0]) : item,
      );
    }
    return hash128(
      stableStringify({
        globalHash,
        startFrame: chunk.startFrame,
        endFrame: chunk.endFrame,
        windowed,
        derived: input.perChunk?.(chunk) ?? null,
      }),
    );
  });
}
