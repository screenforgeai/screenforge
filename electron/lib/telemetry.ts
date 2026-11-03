import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { PostHog } from 'posthog-node';
import log from './logger';

let posthogClient: PostHog | null = null;
let anonymousId: string | null = null;

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
  const sentryDsn = process.env.SENTRY_DSN?.trim();
  const posthogKey = process.env.POSTHOG_API_KEY?.trim();
  const posthogHost = process.env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

  anonymousId = loadOrCreateAnonymousId();

  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: app.isPackaged ? 'production' : 'development',
      release: `screenforge@${app.getVersion()}`,
    });
    Sentry.setUser({ id: anonymousId });
    log.info('[telemetry] Sentry initialized');
  }

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
        app_version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        is_packaged: app.isPackaged,
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

export function identifyUser(name?: string, email?: string): void {
  if (anonymousId) {
    Sentry.setUser({ id: anonymousId, ...(email && { email }), ...(name && { username: name }) });
  }
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
