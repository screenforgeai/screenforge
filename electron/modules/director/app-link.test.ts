import { describe, expect, it } from 'vitest';
import { APP_LINK_SCHEME, findAppLinkInArgv, parseAppLink } from './app-link';

describe('app links', () => {
  it('use their own scheme, separate from the internal screenforge:// file protocol', () => {
    expect(APP_LINK_SCHEME).toBe('screenforge-app');
  });

  it('read a sign-in callback', () => {
    expect(parseAppLink('screenforge-app://sign-in')).toEqual({ type: 'sign-in' });
    expect(parseAppLink('screenforge-app://sign-in/')).toEqual({ type: 'sign-in' });
  });

  it('read an "Open in Screenforge" link for a Director recording', () => {
    expect(
      parseAppLink('screenforge-app://director/demos/6f1c2a3b-1111-4222-8333-944455556666/open'),
    ).toEqual({ type: 'open-director-demo', demoId: '6f1c2a3b-1111-4222-8333-944455556666' });
  });

  it('ignore anything else, including look-alike schemes and malformed ids', () => {
    for (const url of [
      'screenforge://sign-in',
      'https://screenforge.co/sign-in',
      'screenforge-app://unknown',
      'screenforge-app://director/demos/not-a-uuid/open',
      'screenforge-app://director/demos/../../etc/open',
      'not a url',
      '',
    ]) {
      expect(parseAppLink(url)).toBeNull();
    }
  });

  it('find the link a second instance or a cold start was handed on the command line', () => {
    expect(
      findAppLinkInArgv(['/Applications/Screenforge', '--flag', 'screenforge-app://sign-in']),
    ).toBe('screenforge-app://sign-in');
    expect(findAppLinkInArgv(['/usr/bin/screenforge'])).toBeNull();
  });
});
