/** Lets any part of the app open Settings on a given section. */
export type SettingsSection = 'profile' | 'language' | 'director';

const listeners = new Set<(section: SettingsSection) => void>();
let pending: SettingsSection | null = null;

export const openSettings = (section: SettingsSection): void => {
  if (listeners.size === 0) {
    // No settings host on screen yet: the next one to mount picks it up.
    pending = section;
    return;
  }
  pending = null;
  for (const listener of listeners) {
    listener(section);
  }
};

export const onOpenSettings = (cb: (section: SettingsSection) => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** A request made while no host was mounted; cleared once taken. */
export const takePendingSettings = (): SettingsSection | null => {
  const section = pending;
  pending = null;
  return section;
};
