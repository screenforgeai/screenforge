import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingToolbarMic } from './FloatingToolbarMic';

const NOTICE = "System audio isn't recorded on Linux yet. Only your microphone is recorded.";

function renderMic(systemAudioNotice: string | null, popSide?: 'top' | 'bottom') {
  const micDevices = [
    { deviceId: 'mic-1', label: 'Desk mic', kind: 'audioinput', groupId: 'g' } as MediaDeviceInfo,
  ];
  render(
    <FloatingToolbarMic
      recordState="idle"
      micEnabled
      micLoading={false}
      micLevel={0}
      micDevices={micDevices}
      selectedMicId="mic-1"
      systemAudioNotice={systemAudioNotice}
      onMenuOpenChange={vi.fn()}
      onToggle={vi.fn()}
      onSelectMicDevice={vi.fn()}
      onOpenMicMenu={vi.fn()}
      popSide={popSide}
      avoidCollisions={popSide !== 'bottom'}
    />,
  );
}

function openMicMenu() {
  const buttons = screen.getAllByRole('button');
  // The second button is the microphone source chevron.
  fireEvent.keyDown(buttons[1], { key: 'Enter' });
}

describe('FloatingToolbarMic', () => {
  afterEach(() => {
    cleanup();
  });

  it('explains in the microphone menu when system audio will not be recorded', async () => {
    renderMic(NOTICE);
    openMicMenu();

    expect(await screen.findByRole('note')).toHaveTextContent(NOTICE);
    expect(screen.getByText('Desk mic')).toBeInTheDocument();
  });

  it('shows no notice where system audio is recorded', async () => {
    renderMic(null);
    openMicMenu();

    await screen.findByText('Desk mic');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('opens its menu above the pill by default, below it when told to', async () => {
    renderMic(null);
    openMicMenu();
    expect(await screen.findByRole('menu')).toHaveAttribute('data-side', 'top');
    cleanup();

    // The Wayland toolbar window only grows downward.
    renderMic(null, 'bottom');
    openMicMenu();
    expect(await screen.findByRole('menu')).toHaveAttribute('data-side', 'bottom');
  });
});
