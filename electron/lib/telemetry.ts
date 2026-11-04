import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { PostHog } from 'posthog-node';
import type { FeedbackSubmission, SerializedError } from '../../src/types/index';
import log from './logger';

let posthogClient: PostHog | null = null;
let anonymousId: string | null = null;

// PostHog caps event size; keep the tail, where the failure usually is.
export const FEEDBACK_LOG_MAX_CHARS = 100_000;

function loadOrCreateAnonymousId(): string {
  const idPath = path.join(app.getPath('userData'), 'analytics-id.txt');
  try {
    if (fs.existsSync(idPath)) {
      const stored = fs.readFileSync(idPath, 'utf8').trim();
      if (stored.length > 0) {
        return stored;
      }
    }
  } catch {
    // ignore read errors
  }

  const id = crypto.randomUUID();
  try {
    fs.writeFileSync(idPath, id, 'utf8');
  } catch {
    // ignore write errors — id will be regenerated next launch
  }
  return id;
}

export function initTelemetry(): void {
  const posthogKey = process.env.POSTHOG_API_KEY?.trim();
  const posthogHost = process.env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

  anonymousId = loadOrCreateAnonymousId();

  if (!app.isPackaged) {
    if (posthogKey) {
      log.info('[telemetry] PostHog disabled in local development');
    }
    posthogClient = null;
    return;
  }

  if (posthogKey) {
    posthogClient = new PostHog(posthogKey, {
      host: posthogHost,
      flushAt: 5,
      flushInterval: 5_000,
      // Uncaught exceptions and unhandled rejections in the main process.
      enableExceptionAutocapture: true,
    });
    log.info('[telemetry] PostHog initialized');
  }
}

export function getAnonymousId(): string | null {
  return anonymousId;
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!posthogClient || !anonymousId) {
    return;
  }
  try {
    posthogClient.capture({
      distinctId: anonymousId,
      event,
      properties: {
        ...properties,
        ...commonProperties(),
      },
    });
  } catch (err) {
    log.warn('[telemetry] PostHog capture failed:', err);
  }
}

// app.getAppMetrics() covers every Electron process (main, renderers, GPU helper).
// workingSetSize is in KB on all platforms.
export function trackMemorySnapshot(label: string): void {
  try {
    let totalBytes = 0;
    let processCount = 0;
    for (const metric of app.getAppMetrics()) {
      const wss = (metric as unknown as { memory?: { workingSetSize?: number } }).memory
        ?.workingSetSize;
      if (typeof wss === 'number' && Number.isFinite(wss)) {
        totalBytes += wss * 1024;
        processCount += 1;
      }
    }
    const totalMb = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
    log.info(
      `[telemetry] memory snapshot label=${label} total_mb=${totalMb} processes=${processCount}`,
    );
    trackEvent('app_memory_snapshot', { label, total_mb: totalMb, process_count: processCount });
  } catch {
    // never break the app
  }
}

function commonProperties(): Record<string, unknown> {
  return {
    app_version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    is_packaged: app.isPackaged,
  };
}

// A render loop that throws every frame would otherwise send ~60 events a
// second; one report per error per minute is enough to see it.
const EXCEPTION_REPEAT_WINDOW_MS = 60_000;
const MAX_TRACKED_EXCEPTIONS = 100;
const recentExceptions = new Map<string, { sentAt: number; suppressed: number }>();

/**
 * posthog-node tags each stack frame with its source-map chunk id from
 * globalThis._posthogChunkIds, which the PostHog CLI only fills in inside the
 * renderer bundle. Copy a renderer's ids here so its frames get them too.
 */
function adoptChunkIds(chunkIds: SerializedError['chunkIds']): void {
  if (!chunkIds || typeof chunkIds !== 'object') {
    return;
  }
  const global = globalThis as { _posthogChunkIds?: Record<string, string> };
  for (const [stack, chunkId] of Object.entries(chunkIds)) {
    if (typeof chunkId === 'string') {
      global._posthogChunkIds ??= {};
      global._posthogChunkIds[stack] = chunkId;
    }
  }
}

export function captureException(
  error: SerializedError,
  properties?: Record<string, unknown>,
): void {
  if (!posthogClient || !anonymousId) {
    return;
  }
  try {
    // A tuple, so a ': ' inside the name or message can't make two errors collide.
    const key = JSON.stringify([error.name || 'Error', error.message]);
    const now = Date.now();
    const recent = recentExceptions.get(key);
    if (recent && now - recent.sentAt < EXCEPTION_REPEAT_WINDOW_MS) {
      recent.suppressed += 1;
      return;
    }
    if (!recent && recentExceptions.size >= MAX_TRACKED_EXCEPTIONS) {
      recentExceptions.clear();
    }
    recentExceptions.set(key, { sentAt: now, suppressed: 0 });

    const restored = new Error(error.message);
    restored.name = error.name || 'Error';
    if (error.stack) {
      restored.stack = error.stack;
    }
    adoptChunkIds(error.chunkIds);
    posthogClient.captureException(restored, anonymousId, {
      ...properties,
      ...(recent?.suppressed ? { suppressed_repeats: recent.suppressed } : {}),
      ...commonProperties(),
    });
  } catch (err) {
    log.warn('[telemetry] PostHog exception capture failed:', err);
  }
}

export function submitFeedback(feedback: FeedbackSubmission): void {
  const logs = feedback.logs ?? '';
  const logsTruncated = logs.length > FEEDBACK_LOG_MAX_CHARS;
  trackEvent('feedback_submitted', {
    ...feedback.context,
    message: feedback.message,
    name: feedback.name || undefined,
    email: feedback.email || undefined,
    source: feedback.source,
    report_type: feedback.reportType,
    rating: feedback.rating,
    logs_attached: logs.length > 0,
    logs_truncated: logsTruncated,
    logs: logs ? logs.slice(-FEEDBACK_LOG_MAX_CHARS) : undefined,
  });
}

export function identifyUser(name?: string, email?: string): void {
  if (posthogClient && anonymousId) {
    posthogClient.identify({
      distinctId: anonymousId,
      properties: { ...(name && { name }), ...(email && { email }) },
    });
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
}
