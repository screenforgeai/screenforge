/**
 * Renderer-side analytics helper.
 * Wraps window.screenforge.trackEvent for use in React components.
 * All events are forwarded to the main process and sent to PostHog.
 */

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
