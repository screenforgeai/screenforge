// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { installNavigationGuards, isAppPageUrl } from './navigation-guard';

const PACKAGED_PAGE =
  'file:///opt/Screenforge/resources/app.asar/.vite/renderer/main_window/index.html';
const DEV_PAGE = 'http://localhost:5173';

type NavigateListener = (details: { url: string; preventDefault: () => void }) => void;
type OpenHandler = (details: { url: string }) => { action: string };

function createFakeContents() {
  let navigateListener: NavigateListener | null = null;
  let openHandler: OpenHandler | null = null;
  const contents = {
    on: vi.fn((event: string, listener: NavigateListener) => {
      if (event === 'will-navigate') {
        navigateListener = listener;
      }
      return contents;
    }),
    setWindowOpenHandler: vi.fn((handler: OpenHandler) => {
      openHandler = handler;
    }),
  };

  return {
    contents,
    navigate(url: string): boolean {
      const preventDefault = vi.fn();
      navigateListener?.({ url, preventDefault });
      return preventDefault.mock.calls.length === 0;
    },
    open(url: string) {
      return openHandler?.({ url });
    },
  };
}

describe('isAppPageUrl', () => {
  it('accepts the packaged renderer page with any hash', () => {
    expect(isAppPageUrl(`${PACKAGED_PAGE}#toolbar`, PACKAGED_PAGE)).toBe(true);
  });

  it('accepts any page on the dev server origin', () => {
    expect(isAppPageUrl('http://localhost:5173/#export-worker', DEV_PAGE)).toBe(true);
  });

  it('rejects other files, other origins and malformed URLs', () => {
    expect(isAppPageUrl('file:///home/user/.ssh/id_rsa', PACKAGED_PAGE)).toBe(false);
    expect(isAppPageUrl('https://example.com/', PACKAGED_PAGE)).toBe(false);
    expect(isAppPageUrl('http://localhost:5174/', DEV_PAGE)).toBe(false);
    expect(isAppPageUrl('not a url', DEV_PAGE)).toBe(false);
  });

  it('rejects the packaged page path on another host (a Windows network share)', () => {
    const onServer = PACKAGED_PAGE.replace('file:///', 'file://attacker-server/');

    expect(isAppPageUrl(onServer, PACKAGED_PAGE)).toBe(false);
  });
});

describe('installNavigationGuards', () => {
  it('blocks navigation away from the app page but allows the app page', () => {
    const fake = createFakeContents();
    installNavigationGuards(fake.contents as never, PACKAGED_PAGE, vi.fn());

    expect(fake.navigate('https://example.com/')).toBe(false);
    expect(fake.navigate('file:///etc/passwd')).toBe(false);
    expect(fake.navigate(`${PACKAGED_PAGE}#splash`)).toBe(true);
  });

  it('denies new windows and opens web links in the system browser', () => {
    const fake = createFakeContents();
    const openExternal = vi.fn();
    installNavigationGuards(fake.contents as never, DEV_PAGE, openExternal);

    expect(fake.open('https://example.com/')).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');

    openExternal.mockClear();
    expect(fake.open('file:///etc/passwd')).toEqual({ action: 'deny' });
    expect(fake.open('javascript:alert(1)')).toEqual({ action: 'deny' });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
