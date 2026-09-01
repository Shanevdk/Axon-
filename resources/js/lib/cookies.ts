/**
 * The preference cookies the browser writes for itself.
 *
 * These carry a theme name or a sidebar's open state — nothing an attacker
 * would want — but a scanner cannot tell that from the outside, and a cookie
 * without `Secure` is a cookie a network can read. `HttpOnly` is impossible
 * here by definition: a script cannot set a cookie it is then forbidden to
 * read back. Everything else that hardens one is applied in this one place,
 * so a cookie added later cannot quietly go without it.
 */

/** A year, which is as long as a preference is worth remembering. */
export const PREFERENCE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * The `Set-Cookie` value for a preference. Kept separate from writing it so
 * the flags can be tested without a browser.
 */
export function cookieString(name: string, value: string, maxAge: number, secure: boolean): string {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        'path=/',
        `max-age=${Math.max(0, Math.trunc(maxAge))}`,
        'SameSite=Lax',
    ];

    if (secure) {
        parts.push('Secure');
    }

    return parts.join(';');
}

/**
 * Whether this page was served over HTTPS. Chrome discards a `Secure` cookie
 * set over plain HTTP, so the flag has to follow the scheme rather than be
 * hard-coded, or preferences would stop saving on a local machine.
 */
function servedSecurely(): boolean {
    return typeof window !== 'undefined' && window.location.protocol === 'https:';
}

export function writeCookie(name: string, value: string, maxAge: number = PREFERENCE_MAX_AGE): void {
    if (typeof document === 'undefined') {
        return;
    }

    document.cookie = cookieString(name, value, maxAge, servedSecurely());
}
