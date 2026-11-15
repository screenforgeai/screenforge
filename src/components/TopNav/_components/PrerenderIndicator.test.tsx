import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExportPrerenderStatus } from '../../../types';
import { usePrerenderStore } from '../../../hooks/useExportPrerender';
import { PrerenderIndicator } from './PrerenderIndicator';

const KEY = 'mp4|1080p|60|high';

function setStatus(status: ExportPrerenderStatus | null, stateVersion = 1) {
  usePrerenderStore.setState({ stateVersion, settingsKey: KEY, status });
}

beforeEach(() => setStatus(null));
afterEach(() => {
  cleanup();
  usePrerenderStore.setState({ stateVersion: 0, settingsKey: null, status: null, blocked: false });
});

describe('PrerenderIndicator', () => {
  it('shows progress while the pre-render is running', () => {
    setStatus({ phase: 'rendering', total: 38, cached: 17, stateVersion: 1 });
    render(<PrerenderIndicator />);
    expect(screen.getByText('Prerendering 44%')).toBeInTheDocument();
  });

  it('shows what is ready while paused', () => {
    setStatus({ phase: 'failed', total: 10, cached: 6, stateVersion: 1 });
    render(<PrerenderIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent('60% prerendered');
  });

  it('says the export is ready once every chunk is rendered', () => {
    setStatus({ phase: 'done', total: 10, cached: 10, stateVersion: 1 });
    render(<PrerenderIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent('Export ready');
  });

  it('hides until a pre-render has reported', () => {
    render(<PrerenderIndicator />);
    expect(screen.queryByText(/export/i)).toBeNull();
    act(() => setStatus({ phase: 'rendering', total: 10, cached: 3, stateVersion: 1 }));
    expect(screen.getByText('Prerendering 30%')).toBeInTheDocument();
  });

  it('shows it is preparing again with the last known share right after an edit', () => {
    setStatus({ phase: 'failed', total: 10, cached: 6, stateVersion: 1 });
    render(<PrerenderIndicator />);
    expect(screen.getByText('60% prerendered')).toBeInTheDocument();
    act(() => usePrerenderStore.setState({ stateVersion: 2 }));
    expect(screen.getByText('Prerendering 60%')).toBeInTheDocument();
  });

  it('never claims ready, or 100%, for a project that changed since', () => {
    setStatus({ phase: 'done', total: 10, cached: 10, stateVersion: 1 });
    render(<PrerenderIndicator />);
    expect(screen.getByText('Export ready')).toBeInTheDocument();
    act(() => usePrerenderStore.setState({ stateVersion: 2 }));
    expect(screen.getByText('Prerendering 99%')).toBeInTheDocument();
    expect(screen.queryByText('Export ready')).toBeNull();
  });

  it('hides after an edit when the pre-render cannot run (on battery)', () => {
    setStatus({ phase: 'done', total: 10, cached: 10, stateVersion: 1 });
    render(<PrerenderIndicator />);
    act(() => usePrerenderStore.setState({ stateVersion: 2, blocked: true }));
    expect(screen.queryByText(/export/i)).toBeNull();
  });

  it('follows progress updates', () => {
    setStatus({ phase: 'rendering', total: 4, cached: 1, stateVersion: 1 });
    render(<PrerenderIndicator />);
    expect(screen.getByText('Prerendering 25%')).toBeInTheDocument();
    act(() => setStatus({ phase: 'rendering', total: 4, cached: 3, stateVersion: 1 }));
    expect(screen.getByText('Prerendering 75%')).toBeInTheDocument();
  });
});
