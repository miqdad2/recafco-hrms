/**
 * Foundation-unit storage: access + refresh tokens both live in localStorage.
 * See progress-tracker.md — production should move to httpOnly cookies or a
 * stronger storage approach before this system holds real employee data.
 */
const ACCESS_TOKEN_KEY = 'recafco.accessToken';
const REFRESH_TOKEN_KEY = 'recafco.refreshToken';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getStoredAccessToken(): string | null {
  return isBrowser() ? window.localStorage.getItem(ACCESS_TOKEN_KEY) : null;
}

export function getStoredRefreshToken(): string | null {
  return isBrowser() ? window.localStorage.getItem(REFRESH_TOKEN_KEY) : null;
}

export function storeTokens(accessToken: string, refreshToken: string): void {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearStoredTokens(): void {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}
