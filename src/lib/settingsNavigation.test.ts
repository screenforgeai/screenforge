import { describe, expect, it, vi } from 'vitest';
import { onOpenSettings, openSettings, takePendingSettings } from './settingsNavigation';

describe('settings navigation', () => {
  it('tells the settings host which section to open', () => {
    const cb = vi.fn();
    const off = onOpenSettings(cb);
    openSettings('director');
    expect(cb).toHaveBeenCalledWith('director');
    expect(takePendingSettings()).toBeNull();
    off();
  });

  it('holds the request until a host mounts (the sidebar is hidden in focus mode)', () => {
    openSettings('director');
    expect(takePendingSettings()).toBe('director');
    expect(takePendingSettings()).toBeNull();
  });
});
