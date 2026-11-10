import type { RecordingResult } from '../../../types/index';
import type { ZoomClip } from '../../../types/timeline';
import { getClickEvents, getMoveEvents, type ClickEvent, type MoveEvent } from '../cursor/analyze';
import { getKeyEvents, getTypingWindows, type TypingWindow } from '../keyboard/analyze';
import { DEFAULT_ZOOM_CLIP } from '../../../store/defaults';
import { normalizeZoomClip } from './clip';

const CLUSTER_GAP = 3;
const SPATIAL_THRESHOLD = 0.25;
const CONTINUATION_GAP = 1.1;
const PRE_ROLL_MIN = 0.35;
const PRE_ROLL_MAX = 0.75;
const POST_ROLL_MIN = 0.5;
const POST_ROLL_MAX = 2.5;
const REGION_RADIUS = 0.2;
const MIN_GAP = 3.0;
const MIN_SCALE = 1.4;
const MAX_SCALE = 2.8;
export const ADD_ZOOM_WINDOW = 0.75;
export const ADD_ZOOM_MIN_CONFIDENCE = 0.55;
export const ADD_ZOOM_FALLBACK_SCALE = 1.8;
const DETECT_MIN_CONFIDENCE = 0.42;
const CONTINUATION_MIN_CONFIDENCE = 0.3;
const SHORT_CLIP_DURATION = 1.35;
const SHORT_MERGE_GAP = 1.5;
const MIN_AUTO_ZOOM_DURATION = 1.6;
const MIN_STABLE_HOLD = 0.35;
const COMFORTABLE_TYPING_SCALE = 1.55;
const TIGHT_TYPING_SCALE = 1.8;
const POST_NORMALIZE_MERGE_GAP = 1.2;
const POST_NORMALIZE_STITCH_GAP = 2.0;

type Point = {
  nx: number;
  ny: number;
};

type ClickPoint = ClickEvent;

export interface InteractionWindow {
  start: number;
  end: number;
  centerTime: number;
}

export interface ScaleEstimate {
  scale: number;
  targetRadius: number;
  tightness: number;
  noise: number;
}

export interface ZoomCandidate {
  cx: number;
  cy: number;
  scale: number;
  targetRadius: number;
  confidence: number;
  start: number;
  end: number;
  easeOut: number;
  clicks: ClickPoint[];
  window: InteractionWindow;
}

export interface ZoomDefaults {
  cx: number;
  cy: number;
  scale: number;
  confidence: number;
}

interface NormalizedRecording {
  moveEvents: MoveEvent[];
  clickEvents: ClickEvent[];
  typingWindows: TypingWindow[];
  metric: SpatialMetric;
}

interface SpatialMetric {
  width: number;
  height: number;
  basis: number;
}

// scale is optional so existing callers continue to work.
export function defaultZoomClip(
  id: string,
  start: number,
  end: number,
  cx = DEFAULT_ZOOM_CLIP.cx,
  cy = DEFAULT_ZOOM_CLIP.cy,
  scale = DEFAULT_ZOOM_CLIP.scale,
): ZoomClip {
  return normalizeZoomClip({ id, start, end, ...DEFAULT_ZOOM_CLIP, cx, cy, scale });
}

export function defaultCinematicZoomClip(
  id: string,
  start: number,
  end: number,
  cx = DEFAULT_ZOOM_CLIP.cx,
  cy = DEFAULT_ZOOM_CLIP.cy,
  scale = Math.max(DEFAULT_ZOOM_CLIP.scale, 2.2),
): ZoomClip {
  return normalizeZoomClip({
    id,
    start,
    end,
    ...DEFAULT_ZOOM_CLIP,
    cx,
    cy,
    scale,
    preset: 'cinematic',
    easeIn: 0.75,
    easeOut: 0.85,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScale(value: number): number {
  return Math.round(value * 10) / 10;
}

function createSpatialMetric(recording: RecordingResult): SpatialMetric {
  const width = Math.max(1, recording.recordingArea?.width ?? 1);
  const height = Math.max(1, recording.recordingArea?.height ?? 1);
  return {
    width,
    height,
    basis: Math.max(1, Math.min(width, height)),
  };
}

function distance(a: Point, b: Point, metric?: SpatialMetric): number {
  if (!metric) {
    return Math.sqrt((a.nx - b.nx) ** 2 + (a.ny - b.ny) ** 2);
  }

  return (
    Math.sqrt(((a.nx - b.nx) * metric.width) ** 2 + ((a.ny - b.ny) * metric.height) ** 2) /
    metric.basis
  );
}

function isPrimaryClick(click: ClickEvent): boolean {
  return (
    click.button === undefined ||
    click.button === 'left' ||
    click.button === 0 ||
    click.button === 1 ||
    click.button === '0' ||
    click.button === '1'
  );
}

function normalizeRecording(recording: RecordingResult): NormalizedRecording | null {
  const { recordingArea, startTime, mouseData } = recording;
  if (!recordingArea || !startTime) {
    return null;
  }

  const keyEvents = getKeyEvents(mouseData, startTime);
  return {
    moveEvents: getMoveEvents(mouseData, startTime, recordingArea, recording.captureBoundsTimeline),
    clickEvents: getClickEvents(
      mouseData,
      startTime,
      recordingArea,
      recording.captureBoundsTimeline,
    ).filter((e) => e.t >= 0 && isPrimaryClick(e)),
    typingWindows: getTypingWindows(keyEvents),
    metric: createSpatialMetric(recording),
  };
}

function interpolateMoveCursor(moveEvents: MoveEvent[], t: number): Point | null {
  if (moveEvents.length === 0) {
    return null;
  }

  let lo = 0;
  let hi = moveEvents.length - 1;
  let prev = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (moveEvents[mid].t <= t) {
      prev = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (prev <= 0) {
    return { nx: moveEvents[0].nx, ny: moveEvents[0].ny };
  }
  if (prev >= moveEvents.length - 1) {
    return { nx: moveEvents[prev].nx, ny: moveEvents[prev].ny };
  }

  const a = moveEvents[prev];
  const b = moveEvents[prev + 1];
  const gap = b.t - a.t;
  if (gap <= 0 || gap > 0.2) {
    return { nx: a.nx, ny: a.ny };
  }

  const alpha = (t - a.t) / gap;
  return {
    nx: a.nx + (b.nx - a.nx) * alpha,
    ny: a.ny + (b.ny - a.ny) * alpha,
  };
}

function densityCenter(clicks: ClickPoint[], metric: SpatialMetric): { cx: number; cy: number } {
  if (clicks.length === 1) {
    return { cx: clicks[0].nx, cy: clicks[0].ny };
  }

  const seedCx = clicks.reduce((sum, click) => sum + click.nx, 0) / clicks.length;
  const seedCy = clicks.reduce((sum, click) => sum + click.ny, 0) / clicks.length;

  let wx = 0;
  let wy = 0;
  let wSum = 0;
  for (const click of clicks) {
    const d = distance(click, { nx: seedCx, ny: seedCy }, metric);
    const w = 1 / Math.max(d, 0.001);
    wx += click.nx * w;
    wy += click.ny * w;
    wSum += w;
  }

  return { cx: wx / wSum, cy: wy / wSum };
}

function getSpread(points: Point[], cx: number, cy: number, metric: SpatialMetric): number {
  if (points.length === 0) {
    return 0;
  }

  const variance =
    points.reduce((sum, point) => sum + distance(point, { nx: cx, ny: cy }, metric) ** 2, 0) /
    points.length;
  return Math.sqrt(variance);
}

function averageSpeed(
  moveEvents: MoveEvent[],
  start: number,
  end: number,
  metric: SpatialMetric,
): number {
  if (end <= start) {
    return 0;
  }

  let distanceSum = 0;
  let durationSum = 0;
  for (let i = 1; i < moveEvents.length; i++) {
    const a = moveEvents[i - 1];
    const b = moveEvents[i];
    if (b.t < start || a.t > end) {
      continue;
    }
    const segStart = Math.max(start, a.t);
    const segEnd = Math.min(end, b.t);
    const duration = segEnd - segStart;
    if (duration <= 0) {
      continue;
    }

    distanceSum += distance(a, b, metric);
    durationSum += b.t - a.t;
  }

  if (durationSum <= 0) {
    return 0;
  }
  return distanceSum / durationSum;
}

function measureJitter(
  moveEvents: MoveEvent[],
  start: number,
  end: number,
  cx: number,
  cy: number,
  metric: SpatialMetric,
): number {
  const samples = moveEvents.filter((event) => event.t >= start && event.t <= end);
  if (samples.length === 0) {
    return 0;
  }
  return getSpread(samples, cx, cy, metric);
}

function measureResidence(
  moveEvents: MoveEvent[],
  focusTime: number,
  cx: number,
  cy: number,
  radius: number,
  maxWindow: number,
  direction: 'backward' | 'forward',
  metric: SpatialMetric,
): number {
  if (moveEvents.length === 0) {
    return 0;
  }

  if (direction === 'backward') {
    let dwellStart = focusTime;
    for (let i = moveEvents.length - 1; i >= 0; i--) {
      const event = moveEvents[i];
      if (event.t >= focusTime) {
        continue;
      }
      if (focusTime - event.t > maxWindow) {
        break;
      }
      if (distance(event, { nx: cx, ny: cy }, metric) <= radius) {
        dwellStart = event.t;
      } else {
        break;
      }
    }
    return focusTime - dwellStart;
  }

  let dwellEnd = focusTime;
  for (const event of moveEvents) {
    if (event.t <= focusTime) {
      continue;
    }
    if (event.t - focusTime > maxWindow) {
      break;
    }
    if (distance(event, { nx: cx, ny: cy }, metric) <= radius) {
      dwellEnd = event.t;
    } else {
      break;
    }
  }
  return dwellEnd - focusTime;
}

function measureSlowdownBefore(
  moveEvents: MoveEvent[],
  focusTime: number,
  metric: SpatialMetric,
): number {
  const approachSpeed = averageSpeed(moveEvents, focusTime - 0.55, focusTime - 0.18, metric);
  const settleSpeed = averageSpeed(moveEvents, focusTime - 0.18, focusTime, metric);

  if (approachSpeed <= 0.001 && settleSpeed <= 0.001) {
    return 0;
  }

  const relativeSlowdown = clamp(
    (approachSpeed - settleSpeed) / Math.max(approachSpeed, 0.15),
    0,
    1,
  );
  const absoluteSettle = clamp(1 - settleSpeed / 0.6, 0, 1);
  return clamp(relativeSlowdown * 0.65 + absoluteSettle * 0.35, 0, 1);
}

function estimateScale(
  clicks: ClickPoint[],
  moveEvents: MoveEvent[],
  cx: number,
  cy: number,
  dwellBefore: number,
  slowdownBefore: number,
  stabilityAfter: number,
  metric: SpatialMetric,
): ScaleEstimate {
  const spread = getSpread(clicks, cx, cy, metric);
  const preJitter = measureJitter(moveEvents, clicks[0].t - 0.25, clicks[0].t, cx, cy, metric);
  const postJitter = measureJitter(
    moveEvents,
    clicks[clicks.length - 1].t,
    clicks[clicks.length - 1].t + 0.35,
    cx,
    cy,
    metric,
  );
  const repeatScore = clamp((clicks.length - 1) / 3, 0, 1);
  const targetRadius = clamp(
    Math.max(0.055, spread * 1.8, preJitter * 1.1, postJitter * 1.05),
    0.055,
    0.22,
  );
  const fitScale = clamp(0.17 / targetRadius, MIN_SCALE, MAX_SCALE);
  const tightness = clamp(1 - (targetRadius - 0.055) / 0.165, 0, 1);
  const noise = clamp((preJitter + postJitter) / 0.18, 0, 1);
  const intentBoost =
    dwellBefore * 0.35 + slowdownBefore * 0.2 + stabilityAfter * 0.25 + repeatScore * 0.22;
  const scale = roundScale(clamp(fitScale + intentBoost - noise * 0.18, MIN_SCALE, MAX_SCALE));

  return { scale, targetRadius, tightness, noise };
}

function estimateConfidence(
  clicks: ClickPoint[],
  dwellBefore: number,
  slowdownBefore: number,
  stabilityAfter: number,
  scaleEstimate: ScaleEstimate,
): number {
  const repeatScore = clamp((clicks.length - 1) / 3, 0, 1);
  const averageGap =
    clicks.length <= 1
      ? CONTINUATION_GAP
      : (clicks[clicks.length - 1].t - clicks[0].t) / (clicks.length - 1);
  const continuityScore = clamp(1 - averageGap / CONTINUATION_GAP, 0, 1);
  const clickStrength = clicks.length === 1 ? 0.12 : 0.2;
  return clamp(
    0.26 +
      clickStrength +
      scaleEstimate.tightness * 0.2 +
      dwellBefore * 0.14 +
      slowdownBefore * 0.16 +
      stabilityAfter * 0.16 +
      repeatScore * 0.12 +
      continuityScore * 0.08 -
      scaleEstimate.noise * 0.18,
    0,
    1,
  );
}

function estimatePreRoll(dwellBefore: number, slowdownBefore: number): number {
  return clamp(
    PRE_ROLL_MIN + dwellBefore * 0.45 + slowdownBefore * 0.08,
    PRE_ROLL_MIN,
    PRE_ROLL_MAX,
  );
}

function estimatePostRoll(
  moveEvents: MoveEvent[],
  lastClickT: number,
  cx: number,
  cy: number,
  targetRadius: number,
  stabilityAfter: number,
  metric: SpatialMetric,
): number {
  const exitRadius = clamp(Math.max(REGION_RADIUS, targetRadius * 1.6 + 0.04), REGION_RADIUS, 0.3);
  let firstExit: number | null = null;
  let lingerTime = 0;

  for (const event of moveEvents) {
    const dt = event.t - lastClickT;
    if (dt <= 0) {
      continue;
    }
    if (dt > POST_ROLL_MAX) {
      break;
    }

    if (distance(event, { nx: cx, ny: cy }, metric) <= exitRadius) {
      lingerTime = dt;
    } else if (firstExit === null) {
      firstExit = dt;
    }
  }

  if (firstExit !== null && firstExit <= POST_ROLL_MIN) {
    return POST_ROLL_MIN;
  }

  const lingerBonus = Math.min(0.45, lingerTime * 0.22 + stabilityAfter * 0.35);
  const hold =
    firstExit === null ? lingerTime + lingerBonus : firstExit + Math.min(lingerBonus, 0.25);
  return clamp(Math.max(POST_ROLL_MIN, hold), POST_ROLL_MIN, POST_ROLL_MAX);
}

function clusterClicks(clicks: ClickPoint[], metric: SpatialMetric): ClickPoint[][] {
  if (clicks.length === 0) {
    return [];
  }

  const clusters: ClickPoint[][] = [];
  let current: ClickPoint[] = [clicks[0]];

  for (let i = 1; i < clicks.length; i++) {
    const timeGap = clicks[i].t - clicks[i - 1].t;
    const dist = distance(clicks[i], clicks[i - 1], metric);
    if (timeGap <= CONTINUATION_GAP || (timeGap <= CLUSTER_GAP && dist <= SPATIAL_THRESHOLD)) {
      current.push(clicks[i]);
    } else {
      clusters.push(current);
      current = [clicks[i]];
    }
  }

  clusters.push(current);
  return clusters;
}

function analyzeCluster(
  cluster: ClickPoint[],
  moveEvents: MoveEvent[],
  metric: SpatialMetric,
): ZoomCandidate {
  const { cx, cy } = densityCenter(cluster, metric);
  const dwellRadius = clamp(getSpread(cluster, cx, cy, metric) + 0.05, 0.05, 0.12);
  const dwellBefore = clamp(
    measureResidence(moveEvents, cluster[0].t, cx, cy, dwellRadius, 0.55, 'backward', metric) /
      0.55,
    0,
    1,
  );
  const slowdownBefore = measureSlowdownBefore(moveEvents, cluster[0].t, metric);
  const stabilityAfter = clamp(
    measureResidence(
      moveEvents,
      cluster[cluster.length - 1].t,
      cx,
      cy,
      dwellRadius * 1.15,
      0.8,
      'forward',
      metric,
    ) / 0.8,
    0,
    1,
  );
  const scaleEstimate = estimateScale(
    cluster,
    moveEvents,
    cx,
    cy,
    dwellBefore,
    slowdownBefore,
    stabilityAfter,
    metric,
  );
  const preRoll = estimatePreRoll(dwellBefore, slowdownBefore);
  const postRoll = estimatePostRoll(
    moveEvents,
    cluster[cluster.length - 1].t,
    cx,
    cy,
    scaleEstimate.targetRadius,
    stabilityAfter,
    metric,
  );
  const start = Math.max(0, cluster[0].t - preRoll);
  const end = cluster[cluster.length - 1].t + postRoll;
  const easeOut = Math.min(0.8, postRoll * 0.8);
  const confidence = estimateConfidence(
    cluster,
    dwellBefore,
    slowdownBefore,
    stabilityAfter,
    scaleEstimate,
  );

  return {
    cx,
    cy,
    scale: scaleEstimate.scale,
    targetRadius: scaleEstimate.targetRadius,
    confidence,
    start,
    end,
    easeOut,
    clicks: cluster,
    window: {
      start: cluster[0].t,
      end: cluster[cluster.length - 1].t,
      centerTime: (cluster[0].t + cluster[cluster.length - 1].t) / 2,
    },
  };
}

function isTightInteractionRun(candidate: ZoomCandidate): boolean {
  return (
    candidate.clicks.length >= 2 &&
    candidate.window.end - candidate.window.start <= CONTINUATION_GAP * 1.35
  );
}

function getCandidateDuration(candidate: ZoomCandidate): number {
  return candidate.end - candidate.start;
}

function shouldMergeCandidates(
  a: ZoomCandidate,
  b: ZoomCandidate,
  mergedCandidate: ZoomCandidate,
  metric: SpatialMetric,
): boolean {
  const gap = b.start - a.end;
  if (gap >= MIN_GAP) {
    return false;
  }

  const centerDistance = distance({ nx: a.cx, ny: a.cy }, { nx: b.cx, ny: b.cy }, metric);
  if (centerDistance <= 0.35) {
    return true;
  }

  const aDuration = getCandidateDuration(a);
  const bDuration = getCandidateDuration(b);
  const shortRun =
    gap <= SHORT_MERGE_GAP &&
    (aDuration <= SHORT_CLIP_DURATION || bDuration <= SHORT_CLIP_DURATION);
  if (
    shortRun &&
    mergedCandidate.confidence >= CONTINUATION_MIN_CONFIDENCE &&
    mergedCandidate.scale >= MIN_SCALE
  ) {
    return true;
  }

  return (
    gap <= 1.1 &&
    mergedCandidate.confidence >= DETECT_MIN_CONFIDENCE &&
    mergedCandidate.scale >= 1.6 &&
    mergedCandidate.targetRadius <= 0.12
  );
}

function overlapsWindow(candidate: ZoomCandidate, window: TypingWindow): boolean {
  return candidate.start < window.end && candidate.end > window.start;
}

function requiredCandidateDuration(candidate: ZoomCandidate): number {
  return Math.max(
    MIN_AUTO_ZOOM_DURATION,
    DEFAULT_ZOOM_CLIP.easeIn + candidate.easeOut + MIN_STABLE_HOLD,
  );
}

function hasStableHold(candidate: ZoomCandidate): boolean {
  return candidate.end - candidate.start >= requiredCandidateDuration(candidate);
}

function adjustEaseForStableHold(candidate: ZoomCandidate): ZoomCandidate | null {
  const duration = candidate.end - candidate.start;
  if (duration < MIN_AUTO_ZOOM_DURATION) {
    return null;
  }

  const maxEaseOut = duration - DEFAULT_ZOOM_CLIP.easeIn - MIN_STABLE_HOLD;
  if (maxEaseOut < 0.25) {
    return null;
  }

  return {
    ...candidate,
    easeOut: Math.min(candidate.easeOut, maxEaseOut),
  };
}

function applyTypingRules(
  candidate: ZoomCandidate,
  typingWindows: TypingWindow[],
): ZoomCandidate | null {
  const typingWindow = typingWindows.find((window) => overlapsWindow(candidate, window));
  if (!typingWindow || candidate.scale <= COMFORTABLE_TYPING_SCALE) {
    return candidate;
  }

  if (candidate.scale > TIGHT_TYPING_SCALE) {
    const shortened = adjustEaseForStableHold({
      ...candidate,
      end: Math.min(candidate.end, typingWindow.start),
      easeOut: Math.min(candidate.easeOut, 0.55),
    });

    if (shortened && hasStableHold(shortened)) {
      return shortened;
    }
  }

  return {
    ...candidate,
    scale: COMFORTABLE_TYPING_SCALE,
  };
}

function shouldPostMergeCandidates(
  a: ZoomCandidate,
  b: ZoomCandidate,
  mergedCandidate: ZoomCandidate,
  metric: SpatialMetric,
): boolean {
  const gap = b.start - a.end;
  if (gap <= 0) {
    return true;
  }

  const centerDistance = distance({ nx: a.cx, ny: a.cy }, { nx: b.cx, ny: b.cy }, metric);
  const aWeak = a.confidence < ADD_ZOOM_MIN_CONFIDENCE || a.end - a.start < MIN_AUTO_ZOOM_DURATION;
  const bWeak = b.confidence < ADD_ZOOM_MIN_CONFIDENCE || b.end - b.start < MIN_AUTO_ZOOM_DURATION;

  if (gap <= POST_NORMALIZE_MERGE_GAP && (centerDistance <= 0.42 || aWeak || bWeak)) {
    return true;
  }

  return (
    gap <= POST_NORMALIZE_STITCH_GAP &&
    centerDistance <= 0.8 &&
    mergedCandidate.confidence >= CONTINUATION_MIN_CONFIDENCE &&
    mergedCandidate.scale >= MIN_SCALE
  );
}

function normalizeZoomCandidates(
  candidates: ZoomCandidate[],
  moveEvents: MoveEvent[],
  typingWindows: TypingWindow[],
  metric: SpatialMetric,
): ZoomCandidate[] {
  const typingAdjusted = candidates
    .map((candidate) => applyTypingRules(candidate, typingWindows))
    .filter(
      (candidate): candidate is ZoomCandidate =>
        candidate !== null && candidate.end > candidate.start,
    );

  if (typingAdjusted.length === 0) {
    return [];
  }

  const merged: ZoomCandidate[] = [];
  for (const candidate of typingAdjusted.sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(candidate);
      continue;
    }

    const pooledCandidate = analyzeCluster(
      [...previous.clicks, ...candidate.clicks].sort((a, b) => a.t - b.t),
      moveEvents,
      metric,
    );

    if (shouldPostMergeCandidates(previous, candidate, pooledCandidate, metric)) {
      const mergedCandidate = applyTypingRules(
        {
          ...pooledCandidate,
          start: Math.min(previous.start, pooledCandidate.start),
          end: Math.max(candidate.end, pooledCandidate.end),
        },
        typingWindows,
      );
      if (mergedCandidate) {
        merged[merged.length - 1] = mergedCandidate;
      }
      continue;
    }

    merged.push(candidate);
  }

  return merged.flatMap((candidate) => {
    let adjusted = candidate;
    const duration = adjusted.end - adjusted.start;
    if (duration < requiredCandidateDuration(adjusted)) {
      const typingOverlap = typingWindows.some((window) => overlapsWindow(adjusted, window));
      const canStretch =
        !typingOverlap &&
        adjusted.clicks.length >= 2 &&
        adjusted.confidence >= ADD_ZOOM_MIN_CONFIDENCE;
      if (!canStretch) {
        return [];
      }
      adjusted = {
        ...adjusted,
        end: adjusted.start + requiredCandidateDuration(adjusted),
      };
    }

    const stable = adjustEaseForStableHold(adjusted);
    return stable ? [stable] : [];
  });
}

function buildZoomCandidates(recording: RecordingResult): {
  moveEvents: MoveEvent[];
  candidates: ZoomCandidate[];
} {
  const normalized = normalizeRecording(recording);
  if (!normalized || normalized.clickEvents.length === 0) {
    return { moveEvents: normalized?.moveEvents ?? [], candidates: [] };
  }

  const initialCandidates = clusterClicks(normalized.clickEvents, normalized.metric)
    .map((cluster) => analyzeCluster(cluster, normalized.moveEvents, normalized.metric))
    .filter(
      (candidate) =>
        candidate.confidence >= DETECT_MIN_CONFIDENCE ||
        (isTightInteractionRun(candidate) && candidate.confidence >= CONTINUATION_MIN_CONFIDENCE),
    );

  if (initialCandidates.length === 0) {
    return { moveEvents: normalized.moveEvents, candidates: [] };
  }

  const merged: ZoomCandidate[] = [initialCandidates[0]];
  for (let i = 1; i < initialCandidates.length; i++) {
    const current = initialCandidates[i];
    const previous = merged[merged.length - 1];
    const pooledCandidate = analyzeCluster(
      [...previous.clicks, ...current.clicks].sort((a, b) => a.t - b.t),
      normalized.moveEvents,
      normalized.metric,
    );
    if (shouldMergeCandidates(previous, current, pooledCandidate, normalized.metric)) {
      merged[merged.length - 1] = pooledCandidate;
    } else {
      merged.push(current);
    }
  }

  return {
    moveEvents: normalized.moveEvents,
    candidates: normalizeZoomCandidates(
      merged,
      normalized.moveEvents,
      normalized.typingWindows,
      normalized.metric,
    ),
  };
}

export function inferZoomDefaultsAtTime(recording: RecordingResult, time: number): ZoomDefaults {
  const { moveEvents, candidates } = buildZoomCandidates(recording);
  const metric = createSpatialMetric(recording);
  const cursorAtTime = interpolateMoveCursor(moveEvents, time) ?? { nx: 0.5, ny: 0.5 };

  const localCandidate = candidates
    .filter(
      (candidate) =>
        candidate.window.end >= time - ADD_ZOOM_WINDOW &&
        candidate.window.start <= time + ADD_ZOOM_WINDOW,
    )
    .map((candidate) => ({
      candidate,
      score:
        candidate.confidence -
        Math.abs(candidate.window.centerTime - time) * 0.32 -
        distance({ nx: candidate.cx, ny: candidate.cy }, cursorAtTime, metric) * 0.2,
    }))
    .sort((a, b) => b.score - a.score)[0]?.candidate;

  if (localCandidate && localCandidate.confidence >= ADD_ZOOM_MIN_CONFIDENCE) {
    return {
      cx: localCandidate.cx,
      cy: localCandidate.cy,
      scale: localCandidate.scale,
      confidence: localCandidate.confidence,
    };
  }

  const dwellBefore = clamp(
    measureResidence(
      moveEvents,
      time,
      cursorAtTime.nx,
      cursorAtTime.ny,
      0.055,
      0.45,
      'backward',
      metric,
    ) / 0.45,
    0,
    1,
  );
  const slowdownBefore = measureSlowdownBefore(moveEvents, time, metric);
  const stabilityAfter = clamp(
    measureResidence(
      moveEvents,
      time,
      cursorAtTime.nx,
      cursorAtTime.ny,
      0.065,
      0.6,
      'forward',
      metric,
    ) / 0.6,
    0,
    1,
  );

  return {
    cx: cursorAtTime.nx,
    cy: cursorAtTime.ny,
    scale: roundScale(
      clamp(1.65 + dwellBefore * 0.45 + slowdownBefore * 0.2 + stabilityAfter * 0.25, 1.6, 2.4),
    ),
    confidence: clamp(
      0.28 + dwellBefore * 0.32 + slowdownBefore * 0.18 + stabilityAfter * 0.18,
      0,
      0.75,
    ),
  };
}

export function detectZoomClips(recording: RecordingResult): ZoomClip[] {
  const { candidates } = buildZoomCandidates(recording);
  return candidates.map((candidate, index) => ({
    ...defaultZoomClip(
      `zoom-auto-${index}`,
      candidate.start,
      candidate.end,
      candidate.cx,
      candidate.cy,
      candidate.scale,
    ),
    easeOut: candidate.easeOut,
    // Remembered so zoom intensity can be re-applied without losing the analysis.
    autoScale: candidate.scale,
  }));
}
