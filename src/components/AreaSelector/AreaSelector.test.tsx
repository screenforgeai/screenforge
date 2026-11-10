import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AreaSelector } from './AreaSelector';

afterEach(cleanup);

describe('AreaSelector', () => {
  it('asks for a recording area by default', () => {
    render(<AreaSelector />);
    expect(screen.getByText(/select a recording area/i)).toBeInTheDocument();
  });

  it('asks for an area to capture when taking a screenshot', () => {
    render(<AreaSelector purpose="screenshot" />);
    expect(screen.getByText(/select an area to capture/i)).toBeInTheDocument();
    expect(screen.queryByText(/recording/i)).not.toBeInTheDocument();
  });
});
