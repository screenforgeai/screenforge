import { describe, expect, it } from 'vitest';
import { readableErrorMessage, unwrapIpcErrorMessage } from './ipcError';

describe('unwrapIpcErrorMessage', () => {
  it("strips Electron's remote-method wrapper and the cause's error name", () => {
    expect(
      unwrapIpcErrorMessage(
        "Error invoking remote method 'export:run-capture': Error: Input has an unsupported or unrecognizable format.",
      ),
    ).toEqual({
      channel: 'export:run-capture',
      name: 'Error',
      message: 'Input has an unsupported or unrecognizable format.',
    });
  });

  it("keeps the cause's own error type", () => {
    expect(
      unwrapIpcErrorMessage(
        "Error invoking remote method 'library:save': TypeError: x is undefined",
      ),
    ).toEqual({ channel: 'library:save', name: 'TypeError', message: 'x is undefined' });
  });

  it('strips only the first error name, so a cause that starts with "Error" survives', () => {
    expect(
      unwrapIpcErrorMessage(
        "Error invoking remote method 'export:run-capture': Error: Error fetching screenforge://local/a.mp4: 416 Requested Range Not Satisfiable",
      ),
    ).toEqual({
      channel: 'export:run-capture',
      name: 'Error',
      message: 'Error fetching screenforge://local/a.mp4: 416 Requested Range Not Satisfiable',
    });
  });

  it('handles a rejection that was not an Error in the main process', () => {
    expect(unwrapIpcErrorMessage("Error invoking remote method 'export:start': boom")).toEqual({
      channel: 'export:start',
      name: null,
      message: 'boom',
    });
  });

  it('leaves any other message alone', () => {
    expect(unwrapIpcErrorMessage('Export cancelled')).toBeNull();
  });
});

describe('readableErrorMessage', () => {
  it('shows the cause of a failed IPC call, not the wrapper', () => {
    const error = new Error(
      "Error invoking remote method 'export:run-capture': Error: This recording is empty or damaged, so it can't be exported.",
    );

    expect(readableErrorMessage(error, 'Export failed')).toBe(
      "This recording is empty or damaged, so it can't be exported.",
    );
  });

  it("uses a plain error's message as is", () => {
    expect(readableErrorMessage(new Error('No recording loaded'), 'Export failed')).toBe(
      'No recording loaded',
    );
  });

  it('falls back when there is no message to show', () => {
    expect(readableErrorMessage(new Error(''), 'Export failed')).toBe('Export failed');
    expect(readableErrorMessage('nope', 'Export failed')).toBe('Export failed');
  });
});
