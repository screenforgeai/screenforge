import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityIndicator } from './ActivityIndicator';

afterEach(() => {
  cleanup();
});

describe('ActivityIndicator', () => {
  it('renders the provided label', () => {
    render(<ActivityIndicator label="Checking for updates..." minWidthClassName="min-w-[196px]" />);

    expect(screen.getByText('Checking for updates...').closest('div[role="status"]')).toBeTruthy();
  });

  it('renders with the default minimum width', () => {
    render(<ActivityIndicator label="Autosaving..." />);

    expect(screen.getByText('Autosaving...').closest('div')).toHaveClass('min-w-[104px]');
  });

  it('supports a custom minimum width', () => {
    render(<ActivityIndicator label="Downloading update..." minWidthClassName="min-w-[196px]" />);

    expect(screen.getByText('Downloading update...').closest('div')).toHaveClass('min-w-[196px]');
  });

  it('applies the hidden transition state when visible is false', () => {
    render(<ActivityIndicator label="Autosaving..." visible={false} />);

    expect(screen.getByText('Autosaving...').closest('div')).toHaveClass(
      'pointer-events-none',
      '-translate-y-1',
      'opacity-0',
      'delay-0',
    );
  });

  it('applies the visible transition state when visible is true', () => {
    render(<ActivityIndicator label="Autosaving..." visible={true} />);

    expect(screen.getByText('Autosaving...').closest('div')).toHaveClass(
      'translate-y-0',
      'opacity-100',
      'delay-150',
    );
  });
});
