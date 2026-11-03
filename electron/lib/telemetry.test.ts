// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/tmp/screenforge-telemetry-test'),
    getVersion: vi.fn(() => '0.0.22'),
    isPackaged: false,
  },
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

const posthogMock = vi.hoisted(() => {
  const capture = vi.fn();
  const captureException = vi.fn();
  const identify = vi.fn();
  const shutdown = vi.fn();

  return {
    capture,
    captureException,
    identify,
    shutdown,
    PostHog: vi.fn(() => ({
      capture,
      captureException,
      identify,
      shutdown,
    })),
  };
});

vi.mock('electron', () => ({
  app: electronMock.app,
}));

vi.mock('posthog-node', () => ({
  PostHog: posthogMock.PostHog,
}));

vi.mock('./logger', () => ({
  default: loggerMock,
}));

async function loadTelemetryModule() {
  return import('./telemetry');
}

describe('telemetry', () => {
  const originalPosthogKey = process.env.POSTHOG_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.POSTHOG_API_KEY = 'local-posthog-key';
    delete process.env.POSTHOG_HOST;
    electronMock.app.isPackaged = false;
  });

  afterEach(() => {
    if (originalPosthogKey === undefined) {
      delete process.env.POSTHOG_API_KEY;
    } else {
      process.env.POSTHOG_API_KEY = originalPosthogKey;
    }
  });

  it('does not initialize PostHog in local development', async () => {
    const { initTelemetry, trackEvent } = await loadTelemetryModule();

    initTelemetry();
    trackEvent('recording_started');

    expect(posthogMock.PostHog).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('turns on PostHog exception autocapture in packaged builds', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry } = await loadTelemetryModule();

    initTelemetry();

    expect(posthogMock.PostHog).toHaveBeenCalledWith(
      'local-posthog-key',
      expect.objectContaining({
        host: 'https://us.i.posthog.com',
        enableExceptionAutocapture: true,
      }),
    );
  });

  it('reports a renderer error to PostHog with its original stack', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, captureException, getAnonymousId } = await loadTelemetryModule();
    initTelemetry();

    captureException(
      { name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at render (app.tsx:1:1)' },
      { source: 'renderer', operation: 'export' },
    );

    expect(posthogMock.captureException).toHaveBeenCalledTimes(1);
    const [error, distinctId, properties] = posthogMock.captureException.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'TypeError', message: 'boom' });
    expect((error as Error).stack).toContain('at render (app.tsx:1:1)');
    expect(distinctId).toBe(getAnonymousId());
    expect(properties).toEqual(
      expect.objectContaining({ source: 'renderer', operation: 'export', app_version: '0.0.22' }),
    );
  });

  it('sends in-app feedback as a feedback_submitted event, keeping only the newest log lines', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, submitFeedback, FEEDBACK_LOG_MAX_CHARS } = await loadTelemetryModule();
    initTelemetry();
    const logs = `${'old line\n'.repeat(FEEDBACK_LOG_MAX_CHARS)}newest line`;

    submitFeedback({
      message: 'Export froze at 90%',
      name: 'Ada',
      email: 'ada@example.com',
      source: 'feedback_modal',
      reportType: 'bug',
      context: { active_widget: 'export' },
      logs,
    });

    expect(posthogMock.capture).toHaveBeenCalledTimes(1);
    const { event, properties } = posthogMock.capture.mock.calls[0][0];
    expect(event).toBe('feedback_submitted');
    expect(properties).toEqual(
      expect.objectContaining({
        message: 'Export froze at 90%',
        name: 'Ada',
        email: 'ada@example.com',
        source: 'feedback_modal',
        report_type: 'bug',
        active_widget: 'export',
        logs_attached: true,
        logs_truncated: true,
      }),
    );
    expect(properties.logs).toHaveLength(FEEDBACK_LOG_MAX_CHARS);
    expect(properties.logs.endsWith('newest line')).toBe(true);
  });

  it('drops errors and feedback silently in local development', async () => {
    const { initTelemetry, captureException, submitFeedback } = await loadTelemetryModule();
    initTelemetry();

    captureException({ name: 'Error', message: 'dev only' });
    submitFeedback({ message: 'hi', source: 'feedback_modal', reportType: 'idea' });

    expect(posthogMock.captureException).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });
});
