import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TopBarButton, TopBarGroup } from './TopBarButtons';

afterEach(cleanup);

const hoverPill = (name: string) =>
  screen.getByRole('button', { name }).querySelector('[data-pill="hover"]');
const selectedPill = (name: string) =>
  screen.getByRole('button', { name }).querySelector('[data-pill="selected"]');

const renderGroup = () =>
  render(
    <TopBarGroup id="test" aria-label="Tools">
      <TopBarButton itemId="a" aria-label="A" selected>
        a
      </TopBarButton>
      <TopBarButton itemId="b" aria-label="B">
        b
      </TopBarButton>
      <TopBarButton itemId="c" aria-label="C" disabled>
        c
      </TopBarButton>
    </TopBarGroup>,
  );

describe('TopBarGroup', () => {
  it('moves the hover background to whichever button the pointer is over', () => {
    renderGroup();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'B' }));
    expect(hoverPill('B')).not.toBeNull();
    // B's background slides over to A (a shared layout animation jsdom can't
    // run, so only the destination is checked here).
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'A' }));
    expect(hoverPill('A')).not.toBeNull();
  });

  it('clears the hover background when the pointer leaves the group', async () => {
    renderGroup();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'B' }));
    fireEvent.mouseLeave(screen.getByRole('group', { name: 'Tools' }));
    await waitFor(() => expect(hoverPill('B')).toBeNull());
  });

  it('never highlights a disabled button', () => {
    renderGroup();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'C' }));
    expect(hoverPill('C')).toBeNull();
  });

  it('marks the selected button with its own background', () => {
    renderGroup();
    expect(selectedPill('A')).not.toBeNull();
    expect(selectedPill('B')).toBeNull();
  });
});
