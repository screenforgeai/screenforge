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
  const shutdown = vi.fn();

  return {
    capture,
    shutdown,
    PostHog: vi.fn(() => ({
      capture,
      shutdown,
    })),
  };
});

vi.mock('electron', () => ({
  app: electronMock.app,
}));

vi.mock('@sentry/electron/main', () => ({
  init: vi.fn(),
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
});
