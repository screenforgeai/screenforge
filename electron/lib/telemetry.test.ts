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

  it('strips the user name from autocaptured crashes too', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry } = await loadTelemetryModule();
    initTelemetry();

    const [, options] = posthogMock.PostHog.mock.calls[0] as unknown as [
      string,
      { before_send: (event: unknown) => unknown },
    ];
    const sent = options.before_send({
      event: '$exception',
      properties: {
        $exception_list: [{ value: "EACCES: open '/Users/jane/x.mp4'", type: 'Error' }],
      },
    });

    expect(sent).toEqual({
      event: '$exception',
      properties: { $exception_list: [{ value: "EACCES: open '~/x.mp4'", type: 'Error' }] },
    });
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

  it("reports a failed IPC call under its real cause, not Electron's wrapper", async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, captureException } = await loadTelemetryModule();
    initTelemetry();
    const wrapped = (cause: string) => ({
      name: 'Error',
      message: `Error invoking remote method 'export:run-capture': ${cause}`,
      // The renderer-side stack is Electron's IPC plumbing, the same for every cause.
      stack: `Error: Error invoking remote method 'export:run-capture': ${cause}\n    at node:electron/js2c/renderer_init:2:9921`,
    });

    captureException(wrapped('Error: Input has an unsupported or unrecognizable format.'), {
      error_type: 'export_failed',
    });
    captureException(wrapped('TypeError: WebGL is required'));

    expect(posthogMock.captureException).toHaveBeenCalledTimes(2);
    const [first, , firstProperties] = posthogMock.captureException.mock.calls[0];
    expect(first).toMatchObject({
      name: 'Error',
      message: 'Input has an unsupported or unrecognizable format.',
    });
    // No frames, so PostHog groups each cause by its type and message.
    expect((first as Error).stack).toBe(
      'Error: Input has an unsupported or unrecognizable format.',
    );
    expect(firstProperties).toEqual(
      expect.objectContaining({ error_type: 'export_failed', ipc_channel: 'export:run-capture' }),
    );
    const [second] = posthogMock.captureException.mock.calls[1];
    expect(second).toMatchObject({ name: 'TypeError', message: 'WebGL is required' });
  });

  it("never gives a stackless renderer error the main process's own stack", async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, captureException } = await loadTelemetryModule();
    initTelemetry();

    captureException({ name: 'Error', message: 'rejected with a string' });

    const [error] = posthogMock.captureException.mock.calls[0];
    expect((error as Error).stack).toBe('Error: rejected with a string');
  });

  it.each([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop limit exceeded',
  ])('ignores the harmless browser warning "%s"', async (message) => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, captureException } = await loadTelemetryModule();
    initTelemetry();

    captureException({ name: 'Error', message }, { kind: 'error' });

    expect(posthogMock.captureException).not.toHaveBeenCalled();
  });

  it('never sends the user name in a file path, in events or errors', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, trackEvent, captureException } = await loadTelemetryModule();
    initTelemetry();

    trackEvent('recording_failed', {
      error: 'Native recording did not finalize a readable MP4: /Users/jane/Library/x.mp4',
    });
    captureException(
      {
        name: 'Error',
        message: "ENOENT: no such file, open 'C:\\Users\\Jane\\Videos\\out.mp4'",
        stack: 'Error: ENOENT\n    at /home/jane/app/main.js:1:1',
      },
      { error_type: 'export_failed', message: 'failed writing /Users/jane/out.mp4' },
    );

    const [{ properties }] = posthogMock.capture.mock.calls.at(-1) as [
      { properties: Record<string, unknown> },
    ];
    expect(properties.error).toBe(
      'Native recording did not finalize a readable MP4: ~/Library/x.mp4',
    );
    const [error, , exceptionProperties] = posthogMock.captureException.mock.calls[0];
    expect((error as Error).message).toBe("ENOENT: no such file, open '~\\Videos\\out.mp4'");
    expect((error as Error).stack).toContain('at ~/app/main.js:1:1');
    expect(exceptionProperties).toEqual(
      expect.objectContaining({ message: 'failed writing ~/out.mp4' }),
    );
    expect(JSON.stringify(posthogMock.capture.mock.calls)).not.toMatch(/jane/i);
    expect(JSON.stringify(posthogMock.captureException.mock.calls)).not.toMatch(/jane/i);
  });

  it('sends a repeating error once a minute, counting the repeats it held back', async () => {
    vi.useFakeTimers();
    try {
      electronMock.app.isPackaged = true;
      const { initTelemetry, captureException } = await loadTelemetryModule();
      initTelemetry();
      const frameError = { name: 'TypeError', message: "reading 'transitionIn'" };

      // A render loop throws the same error every frame.
      for (let i = 0; i < 1000; i++) {
        captureException(frameError, { kind: 'error' });
      }
      expect(posthogMock.captureException).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60_000);
      captureException(frameError, { kind: 'error' });

      expect(posthogMock.captureException).toHaveBeenCalledTimes(2);
      const [, , properties] = posthogMock.captureException.mock.calls[1];
      expect(properties).toEqual(
        expect.objectContaining({ kind: 'error', suppressed_repeats: 999 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hold back a different error', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, captureException } = await loadTelemetryModule();
    initTelemetry();

    captureException({ name: 'TypeError', message: 'first' });
    captureException({ name: 'TypeError', message: 'second' });
    captureException({ name: 'RangeError', message: 'first' });

    expect(posthogMock.captureException).toHaveBeenCalledTimes(3);
  });

  it("hands a renderer's PostHog chunk ids to the SDK before reporting its error", async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, captureException } = await loadTelemetryModule();
    initTelemetry();
    const global = globalThis as { _posthogChunkIds?: Record<string, string> };
    const stackKey = 'Error\n    at file:///app/assets/index-abc.js:1:1';
    let seenAtCapture: Record<string, string> | undefined;
    posthogMock.captureException.mockImplementationOnce(() => {
      seenAtCapture = { ...global._posthogChunkIds };
    });
    try {
      captureException({
        name: 'TypeError',
        message: 'boom',
        chunkIds: { [stackKey]: 'chunk-1', bad: 42 as unknown as string },
      });

      // posthog-node reads globalThis._posthogChunkIds while building frames.
      expect(seenAtCapture).toEqual({ [stackKey]: 'chunk-1' });
    } finally {
      delete global._posthogChunkIds;
    }
  });

  it('tells errors apart even when the separator appears in name or message', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, captureException } = await loadTelemetryModule();
    initTelemetry();

    captureException({ name: 'TypeError', message: 'load: failed' });
    captureException({ name: 'TypeError: load', message: 'failed' });

    expect(posthogMock.captureException).toHaveBeenCalledTimes(2);
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

  it('stops sending usage events, errors and the profile once sharing is turned off', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, setTelemetryEnabled, trackEvent, captureException, identifyUser } =
      await loadTelemetryModule();
    initTelemetry();

    setTelemetryEnabled(false);
    trackEvent('recording_started');
    captureException({ name: 'Error', message: 'boom' });
    identifyUser('Ada', 'ada@example.com');

    expect(posthogMock.capture).not.toHaveBeenCalled();
    expect(posthogMock.captureException).not.toHaveBeenCalled();
    expect(posthogMock.identify).not.toHaveBeenCalled();

    setTelemetryEnabled(true);
    trackEvent('recording_started');

    expect(posthogMock.capture).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'recording_started' }),
    );
  });

  it('starts with sharing off when the saved setting says so', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, trackEvent } = await loadTelemetryModule();
    initTelemetry({ enabled: false });

    trackEvent('app_launched');

    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('still sends feedback the user submits while sharing is off', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, submitFeedback } = await loadTelemetryModule();
    initTelemetry({ enabled: false });

    submitFeedback({ message: 'please add this', source: 'feedback_modal', reportType: 'idea' });

    expect(posthogMock.capture).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'feedback_submitted' }),
    );
  });

  it('drops autocaptured crashes while sharing is off but keeps submitted feedback', async () => {
    electronMock.app.isPackaged = true;
    const { initTelemetry, setTelemetryEnabled } = await loadTelemetryModule();
    initTelemetry();
    const [, options] = posthogMock.PostHog.mock.calls[0] as unknown as [
      string,
      { before_send: (event: { event: string } | null) => { event: string } | null },
    ];
    const crash = { event: '$exception' };
    const feedback = { event: 'feedback_submitted' };

    // Kept (as a redacted copy) while sharing is on.
    expect(options.before_send(crash)).toEqual(crash);

    setTelemetryEnabled(false);

    expect(options.before_send(crash)).toBeNull();
    expect(options.before_send(feedback)).toEqual(feedback);
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
