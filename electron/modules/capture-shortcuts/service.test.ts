// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ globalShortcut: { register: vi.fn(), unregister: vi.fn() } }));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));

import { CAPTURE_SHORTCUTS } from '../../../src/lib/captureShortcuts';
import {
  getRegisteredCaptureShortcuts,
  registerCaptureShortcuts,
  unregisterCaptureShortcuts,
} from './service';

function makeRegistry(taken: string[] = []) {
  return {
    register: vi.fn((accelerator: string) => !taken.includes(accelerator)),
    unregister: vi.fn(),
  };
}

const handlers = { screenshot: vi.fn(), record: vi.fn() };

describe('capture shortcuts', () => {
  beforeEach(() => {
    unregisterCaptureShortcuts(makeRegistry());
  });

  it('registers the screenshot and record shortcuts with their handlers', () => {
    const registry = makeRegistry();

    expect(registerCaptureShortcuts(handlers, registry)).toEqual(CAPTURE_SHORTCUTS);
    expect(registry.register).toHaveBeenCalledWith(
      CAPTURE_SHORTCUTS.screenshot,
      handlers.screenshot,
    );
    expect(registry.register).toHaveBeenCalledWith(CAPTURE_SHORTCUTS.record, handlers.record);
  });

  it('leaves out a shortcut another app holds and keeps the rest', () => {
    const registry = makeRegistry([CAPTURE_SHORTCUTS.record]);

    registerCaptureShortcuts(handlers, registry);

    expect(getRegisteredCaptureShortcuts()).toEqual({ screenshot: CAPTURE_SHORTCUTS.screenshot });
  });

  it('keeps going when registering throws', () => {
    const registry = makeRegistry();
    registry.register.mockImplementationOnce(() => {
      throw new Error('portal refused');
    });

    expect(registerCaptureShortcuts(handlers, registry)).toEqual({
      record: CAPTURE_SHORTCUTS.record,
    });
  });

  it('unregisters only the shortcuts it registered', () => {
    const registry = makeRegistry([CAPTURE_SHORTCUTS.record]);
    registerCaptureShortcuts(handlers, registry);

    unregisterCaptureShortcuts(registry);

    expect(registry.unregister).toHaveBeenCalledTimes(1);
    expect(registry.unregister).toHaveBeenCalledWith(CAPTURE_SHORTCUTS.screenshot);
    expect(getRegisteredCaptureShortcuts()).toEqual({});
  });
});
