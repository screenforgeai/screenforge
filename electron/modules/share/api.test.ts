// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createShareApi } from './api';

describe('share api', () => {
  it('calls Director’s desktop share routes, signed in, through the account wrapper', async () => {
    const request = vi.fn(async () => null);
    const call = vi.fn((fn: () => Promise<unknown>) => fn());
    const api = createShareApi(request as never, call as <T>(fn: () => Promise<T>) => Promise<T>);

    await api.create({ title: 'Demo', contentType: 'video/mp4', sizeBytes: 5, durationS: 1 });
    await api.resume('a/b');
    await api.complete('s1', [{ partNumber: 1, etag: '"e"' }]);
    await api.list();
    await api.remove('s1');

    expect(request.mock.calls).toEqual([
      [
        '/desktop/shares',
        {
          method: 'POST',
          body: { title: 'Demo', contentType: 'video/mp4', sizeBytes: 5, durationS: 1 },
          auth: true,
        },
      ],
      ['/desktop/shares/a%2Fb/upload', { auth: true }],
      [
        '/desktop/shares/s1/complete',
        { method: 'POST', body: { parts: [{ partNumber: 1, etag: '"e"' }] }, auth: true },
      ],
      ['/desktop/shares', { auth: true }],
      ['/desktop/shares/s1', { method: 'DELETE', auth: true }],
    ]);
    expect(call).toHaveBeenCalledTimes(5);
  });
});
