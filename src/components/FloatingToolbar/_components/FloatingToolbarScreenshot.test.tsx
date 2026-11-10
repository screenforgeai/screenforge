import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSource } from 'src/types';
import { FloatingToolbarScreenshot } from './FloatingToolbarScreenshot';

vi.mock('src/lib/analytics', () => ({ trackEvent: vi.fn() }));

const windowSource: DesktopSource = {
  id: 'window:42:0',
  name: 'Docs',
  thumbnail: null,
  appIcon: null,
  appName: 'Browser',
  windowTitle: 'Docs',
};

const api = () => ({
  captureScreenshot: vi.fn().mockResolvedValue(undefined),
  openAreaSelector: vi.fn().mockResolvedValue({ x: 1, y: 2, width: 300, height: 200 }),
  systemWarning: vi.fn(),
  writeDiagnosticLog: vi.fn(),
});

let screenforge: ReturnType<typeof api>;

beforeEach(() => {
  screenforge = api();
  window.screenforge = screenforge as unknown as typeof window.screenforge;
});

afterEach(() => {
  cleanup();
});

const renderMenu = (props: Partial<Parameters<typeof FloatingToolbarScreenshot>[0]> = {}) => {
  const ensurePermissions = vi.fn().mockResolvedValue(true);
  render(
    <FloatingToolbarScreenshot
      disabled={false}
      displaySourceId="screen:1:0"
      windowSources={[windowSource]}
      sourcesLoading={false}
      getWindowLabel={(source) => source.windowTitle ?? source.name}
      ensurePermissions={ensurePermissions}
      onMenuOpenChange={vi.fn()}
      {...props}
    />,
  );
  return { ensurePermissions };
};

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /screenshot/i }));
};

describe('FloatingToolbarScreenshot', () => {
  it('captures the current display', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /entire screen/i }));
    await waitFor(() =>
      expect(screenforge.captureScreenshot).toHaveBeenCalledWith({
        kind: 'display',
        sourceId: 'screen:1:0',
      }),
    );
  });

  it('keeps windows out of the menu until "Window" is opened', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    expect(screen.queryByRole('menuitem', { name: /docs/i })).not.toBeInTheDocument();
    const windowItem = screen.getByRole('menuitem', { name: /^window$/i });
    expect(windowItem).toHaveAttribute('aria-expanded', 'false');

    await user.click(windowItem);

    // The menu stays open, with the windows listed under "Window".
    expect(screen.getByRole('menuitem', { name: /^window$/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: /docs/i })).toBeInTheDocument();
    expect(screenforge.captureScreenshot).not.toHaveBeenCalled();
  });

  it('folds the window list away again when the menu is reopened', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /^window$/i }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await openMenu(user);
    expect(screen.queryByRole('menuitem', { name: /docs/i })).not.toBeInTheDocument();
  });

  it('says so when there are no windows to capture', async () => {
    const user = userEvent.setup();
    renderMenu({ windowSources: [] });
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /^window$/i }));
    expect(screen.getByText(/no windows open/i)).toBeInTheDocument();
  });

  it('captures a window from the list', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /^window$/i }));
    await user.click(screen.getByRole('menuitem', { name: /docs/i }));
    await waitFor(() =>
      expect(screenforge.captureScreenshot).toHaveBeenCalledWith({
        kind: 'window',
        sourceId: 'window:42:0',
      }),
    );
  });

  it('asks for an area first, then captures it', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /select area/i }));
    await waitFor(() =>
      expect(screenforge.captureScreenshot).toHaveBeenCalledWith({
        kind: 'area',
        sourceId: 'screen:1:0',
        area: { x: 1, y: 2, width: 300, height: 200 },
      }),
    );
    // The selector then shows a camera shutter instead of the record button.
    expect(screenforge.openAreaSelector).toHaveBeenCalledWith('screenshot');
  });

  it('does nothing when the area selection is cancelled', async () => {
    const user = userEvent.setup();
    screenforge.openAreaSelector.mockResolvedValue(null);
    renderMenu();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /select area/i }));
    await waitFor(() => expect(screenforge.openAreaSelector).toHaveBeenCalled());
    expect(screenforge.captureScreenshot).not.toHaveBeenCalled();
  });

  it('stops when screen permission is missing', async () => {
    const user = userEvent.setup();
    renderMenu({ ensurePermissions: vi.fn().mockResolvedValue(false) });
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /entire screen/i }));
    await waitFor(() => expect(screenforge.captureScreenshot).not.toHaveBeenCalled());
  });

  it('warns when the capture fails', async () => {
    const user = userEvent.setup();
    screenforge.captureScreenshot.mockRejectedValue(new Error('boom'));
    renderMenu();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /entire screen/i }));
    await waitFor(() =>
      expect(screenforge.systemWarning).toHaveBeenCalledWith(
        expect.stringMatching(/couldn't take the screenshot/i),
      ),
    );
  });

  it('is disabled while recording', () => {
    renderMenu({ disabled: true });
    expect(screen.getByRole('button', { name: /screenshot/i })).toBeDisabled();
  });
});
