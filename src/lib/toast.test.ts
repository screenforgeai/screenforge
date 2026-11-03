import { describe, expect, it } from 'vitest';
import { getToastStyle, getToasterStyle, TOASTER_TOAST_CLASSNAMES } from './toast';

describe('toast layout config', () => {
  it('leaves the toaster viewport at Sonner defaults', () => {
    expect(getToasterStyle()).toEqual({});
  });

  it('centers a narrower toast inside Sonner’s fixed viewport', () => {
    expect(getToastStyle()).toMatchObject({
      left: 0,
      right: 0,
      width: 'max-content',
      maxWidth: 'min(92vw, 32rem)',
      marginInline: 'auto',
    });
  });

  it('keeps toast classes focused on appearance instead of width hacks', () => {
    expect(TOASTER_TOAST_CLASSNAMES.toast).not.toContain('w-fit');
    expect(TOASTER_TOAST_CLASSNAMES.toast).not.toContain('max-w-fit');
    expect(TOASTER_TOAST_CLASSNAMES.toast).not.toContain('w-auto');
  });
});
