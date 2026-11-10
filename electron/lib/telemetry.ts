import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { PostHog } from 'posthog-node';
import type { FeedbackSubmission, SerializedError } from '../../src/types/index';
import { unwrapIpcErrorMessage } from '../../src/lib/ipcError';
import log from './logger';
import { redactUserPaths, redactUserPathsDeep } from './redact-paths';

let posthogClient: PostHog | null = null;
let anonymousId: string | null = null;
// The "Share usage data" setting. Feedback the user submits is sent either way.
let usageDataEnabled = true;
const FEEDBACK_EVENT = 'feedback_submitted';

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

export function initTelemetry({ enabled = true }: { enabled?: boolean } = {}): void {
  usageDataEnabled = enabled;
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
      // Autocaptured crashes bypass captureException(), so the setting and the
      // path redaction are enforced here too.
      before_send: (event) =>
        usageDataEnabled || event?.event === FEEDBACK_EVENT ? redactUserPathsDeep(event) : null,
    });
    log.info('[telemetry] PostHog initialized');
  }
}

export function getAnonymousId(): string | null {
  return anonymousId;
}

export function setTelemetryEnabled(enabled: boolean): void {
  usageDataEnabled = enabled;
  log.info(`[telemetry] usage data sharing ${enabled ? 'on' : 'off'}`);
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (usageDataEnabled) {
    capture(event, properties);
  }
}

function capture(event: string, properties?: Record<string, unknown>): void {
  if (!posthogClient || !anonymousId) {
    return;
  }
  try {
    posthogClient.capture({
      distinctId: anonymousId,
      event,
      properties: {
        // Error text often carries file paths, and so the user's name.
        ...redactUserPathsDeep(properties),
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

// Chromium's ResizeObserver warnings reach window 'error' listeners, but
// nothing is broken when they fire.
const IGNORED_ERROR_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
];

/**
 * A failed ipcRenderer.invoke arrives wrapped in Electron's "Error invoking
 * remote method" text with a stack of IPC plumbing, so every cause would share
 * one PostHog issue. Report the cause instead, without that stack.
 */
function unwrapIpcError(error: SerializedError): { error: SerializedError; channel?: string } {
  const unwrapped = unwrapIpcErrorMessage(error.message);
  if (!unwrapped) {
    return { error };
  }
  return {
    error: {
      ...error,
      name: unwrapped.name ?? 'Error',
      message: unwrapped.message,
      stack: undefined,
    },
    channel: unwrapped.channel,
  };
}

export function captureException(
  reported: SerializedError,
  properties?: Record<string, unknown>,
): void {
  if (!posthogClient || !anonymousId || !usageDataEnabled) {
    return;
  }
  if (IGNORED_ERROR_MESSAGES.includes(reported.message)) {
    return;
  }
  try {
    const { error, channel } = unwrapIpcError(reported);
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

    // Paths in the message and stack would carry the user's name.
    const restored = new Error(redactUserPaths(error.message));
    restored.name = error.name || 'Error';
    // Without the renderer's stack, keep a frameless one: this process's own
    // frames (IpcMainImpl...) are the same for every error and would group
    // unrelated errors into one issue.
    restored.stack = error.stack
      ? redactUserPaths(error.stack)
      : `${restored.name}: ${restored.message}`;
    adoptChunkIds(error.chunkIds);
    posthogClient.captureException(restored, anonymousId, {
      ...redactUserPathsDeep(properties),
      ...(channel && { ipc_channel: channel }),
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
  capture(FEEDBACK_EVENT, {
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
  if (posthogClient && anonymousId && usageDataEnabled) {
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
