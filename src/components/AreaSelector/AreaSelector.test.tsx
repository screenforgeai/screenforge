import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AreaSelector } from './AreaSelector';

const screenforge = {
  confirmAreaSelection: vi.fn().mockResolvedValue(undefined),
  cancelAreaSelection: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'screenforge', {
    value: screenforge,
    configurable: true,
    writable: true,
  });
});

afterEach(cleanup);

describe('AreaSelector', () => {
  it('asks for a recording area by default', () => {
    render(<AreaSelector />);
    expect(screen.getByText(/select a recording area/i)).toBeInTheDocument();
  });

  it('asks for an area to capture when taking a screenshot', () => {
    render(<AreaSelector purpose="screenshot" />);
    expect(screen.getByText(/select an area/i)).toBeInTheDocument();
    expect(screen.getByText(/enter for the whole screen/i)).toBeInTheDocument();
    expect(screen.queryByText(/recording/i)).not.toBeInTheDocument();
  });

  it('takes the whole screen on Enter when nothing is selected', () => {
    render(<AreaSelector purpose="screenshot" />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screenforge.confirmAreaSelection).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });

  it('does not start a full-screen recording on Enter', () => {
    render(<AreaSelector />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screenforge.confirmAreaSelection).not.toHaveBeenCalled();
  });

  it('moves a drawn selection with the arrow keys before confirming it', () => {
    const { container } = render(<AreaSelector purpose="screenshot" />);
    const surface = container.firstChild as HTMLElement;
    fireEvent.mouseDown(surface, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 200 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 200 });

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(screenforge.confirmAreaSelection).toHaveBeenCalledWith({
      x: 101,
      y: 110,
      width: 200,
      height: 100,
    });
  });

  it('cancels on Escape', () => {
    render(<AreaSelector purpose="screenshot" />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screenforge.cancelAreaSelection).toHaveBeenCalledOnce();
  });
});
