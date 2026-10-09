/**
 * The signed-in session, read from the JWT in localStorage — pure decoding in
 * `sessionFromToken` so the rules can be tested without a browser.
 *
 * The token is only *decoded* here, never verified: the backend is the
 * authority on every request. This decides what the UI offers, so it errs
 * towards offering less — an expired or malformed token is no session at all,
 * and `isAdmin` is true only for a literal `true` claim.
 */

export const TOKEN_KEY = 'adminToken';

/** JWT payloads are base64url, which `atob` rejects as soon as one contains `-` or `_`. */
export function decodeToken(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export function sessionFromToken(token, now = Date.now()) {
  if (typeof token !== 'string' || !token) return null;

  const payload = decodeToken(token);
  if (!payload?.id) return null;
  if (payload.exp && payload.exp * 1000 <= now) return null;

  return { token, id: payload.id, isAdmin: payload.isAdmin === true };
}

export function readSession() {
  try {
    return sessionFromToken(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}
