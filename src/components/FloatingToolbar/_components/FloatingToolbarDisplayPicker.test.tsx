import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSource } from '../../../types/index';
import { FloatingToolbarDisplayPicker } from './FloatingToolbarDisplayPicker';

const external: DesktopSource = {
  id: 'screen:0:0',
  name: 'Screen 1',
  thumbnail: 'data:image/png;base64,external',
  appIcon: null,
  displaySize: { width: 2560, height: 1440 },
  isPrimary: false,
};
const builtIn: DesktopSource = {
  id: 'screen:1:0',
  name: 'Screen 2',
  thumbnail: null,
  appIcon: null,
  displayLabel: 'Built-in Retina Display',
  displaySize: { width: 1512, height: 982 },
  isPrimary: true,
};

function renderPicker(props: Partial<Parameters<typeof FloatingToolbarDisplayPicker>[0]> = {}) {
  const handlers = {
    onMenuOpenChange: vi.fn(),
    onSelectTab: vi.fn(),
    onChooseScreen: vi.fn(),
  };
  render(
    <FloatingToolbarDisplayPicker
      screens={[external, builtIn]}
      chosenScreen={builtIn}
      loading={false}
      buttonClassName=""
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const openMenu = () =>
  fireEvent.keyDown(screen.getByRole('button', { name: 'Display' }), { key: 'Enter' });

describe('FloatingToolbarDisplayPicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('lists each monitor with its size, naming the main one', async () => {
    const { onMenuOpenChange } = renderPicker();
    openMenu();

    expect(await screen.findByRole('menuitem', { name: /Display 1/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Built-in Retina Display/ })).toBeInTheDocument();
    expect(screen.getByText('2560 × 1440')).toBeInTheDocument();
    expect(screen.getByText('1512 × 982 · Main display')).toBeInTheDocument();
    expect(onMenuOpenChange).toHaveBeenCalledWith(true);
  });

  it('reports the monitor chosen', async () => {
    const { onChooseScreen } = renderPicker();
    openMenu();

    fireEvent.click(await screen.findByRole('menuitem', { name: /Display 1/ }));

    expect(onChooseScreen).toHaveBeenCalledWith(external);
  });

  it('names the monitor that will be recorded', async () => {
    renderPicker();
    fireEvent.focus(screen.getByRole('button', { name: 'Display' }));

    expect(await screen.findAllByText('Display: Built-in Retina Display')).not.toHaveLength(0);
  });

  it('waits for the screens while they are first listed', async () => {
    renderPicker({ screens: [], chosenScreen: null, loading: true });
    openMenu();

    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(screen.queryByText('No displays found')).not.toBeInTheDocument();
  });
});
