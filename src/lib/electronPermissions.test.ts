import { describe, expect, it } from 'vitest';
import { isAllowedRendererPermission } from './electronPermissions';

describe('isAllowedRendererPermission', () => {
  it('allows the media-related permissions used by recording flows', () => {
    expect(isAllowedRendererPermission('media')).toBe(true);
    expect(isAllowedRendererPermission('audioCapture')).toBe(true);
    expect(isAllowedRendererPermission('microphone')).toBe(true);
    expect(isAllowedRendererPermission('camera')).toBe(true);
    expect(isAllowedRendererPermission('videoCapture')).toBe(true);
  });

  it('allows display-capture for Wayland portal recording', () => {
    // Linux/Wayland: the toolbar records the screen via getDisplayMedia; the
    // real consent flow is the OS portal dialog.
    expect(isAllowedRendererPermission('display-capture')).toBe(true);
  });

  it('rejects unrelated renderer permissions', () => {
    expect(isAllowedRendererPermission('clipboard-read')).toBe(false);
    expect(isAllowedRendererPermission('notifications')).toBe(false);
    expect(isAllowedRendererPermission('geolocation')).toBe(false);
  });
});
