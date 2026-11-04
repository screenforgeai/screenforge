/**
 * Renderer-side analytics helper.
 * Wraps window.screenforge.trackEvent for use in React components.
 * All events are forwarded to the main process and sent to PostHog.
 */

import type { FeedbackSubmission, SerializedError } from '../types/index';

/** Error instances don't survive IPC structured clone intact, so send their fields. */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { name: 'Error', message: error };
  }
  let message: string;
  try {
    message = JSON.stringify(error) ?? String(error);
  } catch {
    message = String(error);
  }
  return { name: 'Error', message };
}

/**
 * Set by the PostHog CLI's chunk-id snippet in a release bundle. The error is
 * reported from the main process, which can't see this window's globals, so
 * it travels with the error.
 */
function posthogChunkIds(): Record<string, string> | undefined {
  const ids = (globalThis as { _posthogChunkIds?: unknown })._posthogChunkIds;
  return ids && typeof ids === 'object' ? { ...(ids as Record<string, string>) } : undefined;
}

/** Reports a caught error to PostHog error tracking. */
export function captureException(error: unknown, properties?: Record<string, unknown>): void {
  try {
    const chunkIds = posthogChunkIds();
    window.screenforge.captureException(
      { ...serializeError(error), ...(chunkIds && { chunkIds }) },
      {
        source: 'renderer',
        ...properties,
      },
    );
  } catch {
    // Silently ignore — error reporting must never break the app.
  }
}

export function submitFeedback(feedback: FeedbackSubmission): void {
  try {
    window.screenforge.submitFeedback(feedback);
  } catch {
    // Silently ignore — analytics must never break the app.
  }
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  try {
    window.screenforge.trackEvent(event, properties);
  } catch {
    // Silently ignore — analytics must never break the app.
  }
}

export function identifyUser(profile: { name?: string; email?: string }): void {
  try {
    window.screenforge.identifyUser(profile);
  } catch {
    // Silently ignore — analytics must never break the app.
  }
}
