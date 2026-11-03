import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureException, serializeError, submitFeedback } from './analytics';

describe('serializeError', () => {
  it('keeps the name, message and stack of an Error', () => {
    const error = new TypeError('bad input');

    expect(serializeError(error)).toEqual({
      name: 'TypeError',
      message: 'bad input',
      stack: error.stack,
    });
  });

  it('turns a thrown string into an Error-shaped payload', () => {
    expect(serializeError('export failed')).toEqual({ name: 'Error', message: 'export failed' });
  });

  it('describes a thrown non-Error object instead of dropping it', () => {
    expect(serializeError({ code: 42 })).toEqual({ name: 'Error', message: '{"code":42}' });
  });
});

describe('renderer error and feedback reporting', () => {
  const bridge = {
    captureException: vi.fn(),
    submitFeedback: vi.fn(),
  };

  beforeEach(() => {
    Object.defineProperty(window, 'screenforge', {
      value: bridge,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forwards a caught error to the main process', () => {
    captureException(new Error('decode failed'), { operation: 'export' });

    expect(bridge.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Error', message: 'decode failed' }),
      { source: 'renderer', operation: 'export' },
    );
  });

  it('forwards feedback to the main process', () => {
    submitFeedback({ message: 'Love it', source: 'feedback_modal', reportType: 'idea' });

    expect(bridge.submitFeedback).toHaveBeenCalledWith({
      message: 'Love it',
      source: 'feedback_modal',
      reportType: 'idea',
    });
  });

  it('never throws when the bridge is unavailable', () => {
    Object.defineProperty(window, 'screenforge', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    expect(() => captureException(new Error('x'))).not.toThrow();
    expect(() =>
      submitFeedback({ message: 'x', source: 'feedback_modal', reportType: 'bug' }),
    ).not.toThrow();
  });
});
