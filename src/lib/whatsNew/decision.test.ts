import { describe, expect, it } from 'vitest';
import { decideWhatsNew } from './decision';

describe('decideWhatsNew', () => {
  it('stays quiet on a fresh install and remembers the version', () => {
    expect(
      decideWhatsNew({ lastSeenVersion: null, currentVersion: '0.8.0', isExistingInstall: false }),
    ).toEqual({ show: false, sinceVersion: null, markSeen: true });
  });

  it('shows the current notes once for an existing user upgrading from before the feature', () => {
    expect(
      decideWhatsNew({ lastSeenVersion: null, currentVersion: '0.8.0', isExistingInstall: true }),
    ).toEqual({ show: true, sinceVersion: null, markSeen: true });
  });

  it('shows everything since the last seen version after an update', () => {
    expect(
      decideWhatsNew({
        lastSeenVersion: '0.6.19',
        currentVersion: '0.8.0',
        isExistingInstall: true,
      }),
    ).toEqual({ show: true, sinceVersion: '0.6.19', markSeen: true });
  });

  it('never shows twice for the same version', () => {
    expect(
      decideWhatsNew({
        lastSeenVersion: '0.8.0',
        currentVersion: '0.8.0',
        isExistingInstall: true,
      }),
    ).toEqual({ show: false, sinceVersion: '0.8.0', markSeen: false });
  });

  it('stays quiet after a downgrade but tracks the running version', () => {
    expect(
      decideWhatsNew({
        lastSeenVersion: '0.9.0',
        currentVersion: '0.8.0',
        isExistingInstall: true,
      }),
    ).toEqual({ show: false, sinceVersion: '0.9.0', markSeen: true });
  });

  it('treats a malformed stored version like a missing one', () => {
    expect(
      decideWhatsNew({
        lastSeenVersion: 'garbage',
        currentVersion: '0.8.0',
        isExistingInstall: true,
      }),
    ).toEqual({ show: true, sinceVersion: null, markSeen: true });
  });
});
