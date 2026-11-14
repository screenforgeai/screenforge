import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackModal } from './FeedbackModal';

const analytics = vi.hoisted(() => ({
  submitFeedback: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('src/lib/analytics', () => analytics);

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeEach(() => {
  Object.defineProperty(window, 'screenforge', {
    value: {
      getSettings: vi.fn().mockResolvedValue({
        profile: { name: 'Ada', email: 'ada@example.com' },
      }),
      getAppVersion: vi.fn().mockResolvedValue('1.2.3'),
      readLogFile: vi.fn().mockResolvedValue('log line'),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      identifyUser: vi.fn(),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FeedbackModal', () => {
  it('sends one feedback_submitted event per report, from the main process', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FeedbackModal open activeWidget="cursor" onClose={onClose} />);
    await waitFor(() => expect(screen.getByDisplayValue('Ada')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Details'), 'Export froze at 90% on a long clip');
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // submitFeedback is tracked as feedback_submitted by the main process, so
    // the renderer must not send a second, message-less one.
    expect(analytics.submitFeedback).toHaveBeenCalledTimes(1);
    expect(analytics.trackEvent).not.toHaveBeenCalledWith('feedback_submitted', expect.anything());
  });
});
