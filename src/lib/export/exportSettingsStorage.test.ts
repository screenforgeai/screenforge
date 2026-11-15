import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_SETTINGS_STORAGE_KEY,
  loadStoredExportSettings,
} from './exportSettingsStorage';

const store = (value: unknown) =>
  localStorage.setItem(EXPORT_SETTINGS_STORAGE_KEY, JSON.stringify(value));

afterEach(() => localStorage.clear());

describe('loadStoredExportSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(loadStoredExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('reads the last-used settings', () => {
    store({ format: 'webm', resolution: '4k', fps: 30, quality: 'fast' });
    expect(loadStoredExportSettings()).toEqual({
      format: 'webm',
      resolution: '4k',
      fps: 30,
      quality: 'fast',
    });
  });

  it('replaces values it does not know with the defaults', () => {
    store({ format: 'avi', resolution: '8k', fps: 'sixty', quality: 'ultra' });
    expect(loadStoredExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('uses the defaults for a saved value that is not an object', () => {
    store(null);
    expect(loadStoredExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
    localStorage.setItem(EXPORT_SETTINGS_STORAGE_KEY, '{not json');
    expect(loadStoredExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
  });
});
