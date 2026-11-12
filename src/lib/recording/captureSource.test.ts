import { describe, expect, it } from 'vitest';
import type { RecordingResult } from '../../types/index';
import {
  displaySurfaceOf,
  knownBrowserOf,
  pageTitleFromWindowTitle,
  recordingPageVisits,
} from './captureSource';

const track = (displaySurface?: string) =>
  ({ getSettings: () => ({ displaySurface }) }) as unknown as MediaStreamTrack;

describe('displaySurfaceOf', () => {
  it('reads what the portal shared', () => {
    expect(displaySurfaceOf(track('browser'))).toBe('browser');
    expect(displaySurfaceOf(track('window'))).toBe('window');
    expect(displaySurfaceOf(track('monitor'))).toBe('monitor');
    expect(displaySurfaceOf(track(undefined))).toBeUndefined();
    expect(displaySurfaceOf(undefined)).toBeUndefined();
  });
});

describe('knownBrowserOf', () => {
  it('names the browser from the app, or else the title', () => {
    expect(knownBrowserOf({ appName: 'Google Chrome' })).toBe('chrome');
    expect(knownBrowserOf({ appName: 'Microsoft Edge' })).toBe('edge');
    expect(knownBrowserOf({ windowTitle: 'Inbox — Mozilla Firefox' })).toBe('firefox');
    expect(knownBrowserOf({ appName: 'Figma', windowTitle: 'Design' })).toBeNull();
    expect(knownBrowserOf(undefined)).toBeNull();
  });
});

describe('pageTitleFromWindowTitle', () => {
  it("drops the browser's name from the end", () => {
    expect(pageTitleFromWindowTitle('Q3 launch – Acme - Google Chrome', 'Google Chrome')).toBe(
      'Q3 launch – Acme',
    );
    expect(pageTitleFromWindowTitle('Inbox — Mozilla Firefox')).toBe('Inbox');
    expect(pageTitleFromWindowTitle('Design file', 'Figma')).toBe('Design file');
  });
});

describe('recordingPageVisits', () => {
  const result = (captureSource?: RecordingResult['captureSource']) =>
    ({ captureSource }) as RecordingResult;

  it("is the window's page title for a window recording", () => {
    expect(
      recordingPageVisits(
        result({
          kind: 'window',
          appName: 'Google Chrome',
          windowTitle: 'Projects - Google Chrome',
        }),
      ),
    ).toEqual([{ t: 0, url: '', title: 'Projects' }]);
  });

  it('is empty for a screen, an area, or an older recording', () => {
    expect(recordingPageVisits(result({ kind: 'display' }))).toEqual([]);
    expect(recordingPageVisits(result(undefined))).toEqual([]);
    expect(recordingPageVisits(null)).toEqual([]);
  });
});
