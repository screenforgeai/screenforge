import type { WebContents } from 'electron';

/**
 * True when `url` is the app's own renderer page: the packaged index.html
 * (any hash or query) or any page on the Vite dev server origin.
 */
export function isAppPageUrl(url: string, appPageUrl: string): boolean {
  let target: URL;
  let appPage: URL;
  try {
    target = new URL(url);
    appPage = new URL(appPageUrl);
  } catch {
    return false;
  }

  if (appPage.protocol === 'file:') {
    return target.protocol === 'file:' && target.pathname === appPage.pathname;
  }
  return target.origin === appPage.origin;
}

/**
 * Keeps foreign pages out of app windows: they could otherwise read local
 * files through the screenforge:// scheme. Navigation away from the app page
 * is blocked, and new windows are denied, with web links opened in the
 * system browser instead.
 */
export function installNavigationGuards(
  contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>,
  appPageUrl: string,
  openExternal: (url: string) => void,
): void {
  contents.on('will-navigate', (details) => {
    if (!isAppPageUrl(details.url, appPageUrl)) {
      details.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      openExternal(url);
    }
    return { action: 'deny' };
  });
}
