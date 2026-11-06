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

  it('captures a window from the list', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
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
    expect(screenforge.openAreaSelector).toHaveBeenCalled();
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
