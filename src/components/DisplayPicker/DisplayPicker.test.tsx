import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayPickerTarget } from '../../types/index';
import { DisplayPicker } from './DisplayPicker';

const target: DisplayPickerTarget = {
  display: { id: 2, label: 'BenQ GW2785TC', width: 1920, height: 1080, isPrimary: false },
  number: 2,
  count: 2,
  purpose: 'record',
};

const screenforge = {
  getDisplayPickerTarget: vi.fn(),
  confirmDisplayPick: vi.fn().mockResolvedValue(undefined),
  cancelDisplayPick: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  screenforge.getDisplayPickerTarget.mockResolvedValue(target);
  Object.defineProperty(window, 'screenforge', {
    value: screenforge,
    configurable: true,
    writable: true,
  });
});

afterEach(cleanup);

describe('DisplayPicker', () => {
  it('names the monitor it covers, with its number and size', async () => {
    render(<DisplayPicker />);

    expect(await screen.findByText('BenQ GW2785TC')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
  });

  it('marks the main display, and names an unnamed one by its number', async () => {
    screenforge.getDisplayPickerTarget.mockResolvedValue({
      ...target,
      display: { ...target.display, label: null, isPrimary: true },
    });
    render(<DisplayPicker />);

    expect(await screen.findByText('Display 2')).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080 · Main display')).toBeInTheDocument();
  });

  it('picks its monitor when clicked anywhere, or with its button', async () => {
    render(<DisplayPicker />);
    fireEvent.click(await screen.findByRole('button', { name: /BenQ GW2785TC/ }));
    expect(screenforge.confirmDisplayPick).toHaveBeenCalledWith();

    fireEvent.click(screen.getByRole('button', { name: 'Record this display' }));
    expect(screenforge.confirmDisplayPick).toHaveBeenCalledTimes(2);
  });

  it('names the action it was opened for', async () => {
    screenforge.getDisplayPickerTarget.mockResolvedValue({ ...target, purpose: 'screenshot' });
    render(<DisplayPicker />);

    expect(
      await screen.findByRole('button', { name: 'Screenshot this display' }),
    ).toBeInTheDocument();
  });

  it('asks for an area when an area is drawn next', async () => {
    screenforge.getDisplayPickerTarget.mockResolvedValue({ ...target, purpose: 'area' });
    render(<DisplayPicker />);

    expect(
      await screen.findByRole('button', { name: 'Select an area on this display' }),
    ).toBeInTheDocument();
  });

  it('picks a monitor by its number key, and cancels on Escape', async () => {
    render(<DisplayPicker />);
    await screen.findByText('BenQ GW2785TC');

    fireEvent.keyDown(window, { key: '1' });
    expect(screenforge.confirmDisplayPick).toHaveBeenCalledWith(1);

    fireEvent.keyDown(window, { key: '3' });
    expect(screenforge.confirmDisplayPick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screenforge.cancelDisplayPick).toHaveBeenCalled();
  });
});
