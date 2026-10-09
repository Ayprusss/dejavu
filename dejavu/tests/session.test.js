import { describe, it, expect } from 'vitest';
import { decodeToken, sessionFromToken } from '../src/lib/session';

const NOW = 1_800_000_000_000;

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const tokenFor = (payload) =>
  `${base64url({ alg: 'HS256' })}.${base64url(payload)}.sig`;

describe('sessionFromToken', () => {
  it('reads id and isAdmin from a live token', () => {
    const token = tokenFor({ id: 'u1', isAdmin: false, exp: NOW / 1000 + 60 });
    expect(sessionFromToken(token, NOW)).toEqual({ token, id: 'u1', isAdmin: false });
  });

  it('is an admin only for a literal true claim', () => {
    const admin = (isAdmin) =>
      sessionFromToken(tokenFor({ id: 'u1', isAdmin }), NOW).isAdmin;
    expect(admin(true)).toBe(true);
    expect(admin(false)).toBe(false);
    expect(admin(undefined)).toBe(false);
    expect(admin(null)).toBe(false);
    expect(admin('false')).toBe(false);
    expect(admin(1)).toBe(false);
  });

  it('treats an expired token as no session', () => {
    const token = tokenFor({ id: 'u1', isAdmin: true, exp: NOW / 1000 - 1 });
    expect(sessionFromToken(token, NOW)).toBeNull();
  });

  it.each([null, undefined, '', 'garbage', 'a.b.c', tokenFor({ isAdmin: true })])(
    'returns null for %p',
    (token) => {
      expect(sessionFromToken(token, NOW)).toBeNull();
    },
  );
});

describe('decodeToken', () => {
  it('decodes base64url payloads that plain atob rejects', () => {
    const payload = { id: 'u1', note: 'a?>b~~~c?>?>' };
    const token = tokenFor(payload);
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(decodeToken(token)).toEqual(payload);
  });
});
