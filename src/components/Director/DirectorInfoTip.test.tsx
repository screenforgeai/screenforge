import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectorInfoTip } from './DirectorInfoTip';

afterEach(cleanup);

describe('DirectorInfoTip', () => {
  it('says what Screenforge Director is when focused', async () => {
    render(<DirectorInfoTip />);

    const button = screen.getByRole('button', { name: 'What is Screenforge Director?' });
    await userEvent.tab();
    expect(button).toHaveFocus();

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Screenforge Director is our cloud app.',
    );
  });
});
