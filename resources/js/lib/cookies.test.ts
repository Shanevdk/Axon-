import { describe, expect, it } from 'vitest';

import { cookieString, PREFERENCE_MAX_AGE } from './cookies';

describe('cookieString', () => {
    it('scopes a preference to the whole site and keeps it off other origins', () => {
        const cookie = cookieString('palette', 'blueprint', PREFERENCE_MAX_AGE, false);

        expect(cookie).toContain('palette=blueprint');
        expect(cookie).toContain('path=/');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).toContain(`max-age=${PREFERENCE_MAX_AGE}`);
    });

    it('marks the cookie Secure only when the page was served over HTTPS', () => {
        // Chrome throws away a Secure cookie set over plain http, so a
        // hard-coded flag would stop preferences saving on a local machine.
        expect(cookieString('appearance', 'dark', 60, true)).toContain(';Secure');
        expect(cookieString('appearance', 'dark', 60, false)).not.toContain('Secure');
    });

    it('escapes a value rather than letting it add flags of its own', () => {
        const cookie = cookieString('palette', 'sand; Domain=elsewhere.test', 60, true);

        expect(cookie).not.toContain('Domain=elsewhere.test');
        expect(cookie).toContain('sand%3B%20Domain%3Delsewhere.test');
    });

    it('refuses a negative age instead of writing a cookie that never expires', () => {
        expect(cookieString('palette', 'mono', -1, false)).toContain('max-age=0');
    });
});
