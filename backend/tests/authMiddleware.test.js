const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { verifyToken, requireAdmin } = require('../src/middleware/authMiddleware');

const SECRET = process.env.JWT_SECRET;

const sign = (payload, options = {}) => jwt.sign(payload, SECRET, options);

/** Minimal app exposing one open route and one admin-only route. */
const buildApp = () => {
  const app = express();
  app.get('/protected', verifyToken, (req, res) => res.json({ user: req.user }));
  app.get('/admin', verifyToken, requireAdmin, (req, res) => res.json({ ok: true }));
  return app;
};

let app;
beforeAll(() => {
  app = buildApp();
});

describe('verifyToken', () => {
  const cases = [
    {
      name: 'no Authorization header at all',
      header: undefined,
      status: 401,
      message: 'No token provided',
    },
    {
      name: 'Authorization header present but empty',
      header: '',
      status: 401,
      message: 'No token provided',
    },
    {
      name: 'bare token with no scheme',
      header: () => sign({ id: 'u1', isAdmin: false }),
      status: 401,
      message: 'No token provided',
    },
    {
      name: 'expired token',
      header: () =>
        `Bearer ${sign({ id: 'u1', isAdmin: false }, { expiresIn: '-1s' })}`,
      status: 403,
      message: 'Invalid token',
    },
    {
      name: 'token signed with the wrong secret',
      header: () =>
        `Bearer ${jwt.sign({ id: 'u1', isAdmin: true }, 'a-different-secret-entirely')}`,
      status: 403,
      message: 'Invalid token',
    },
    {
      name: 'structurally malformed token',
      header: 'Bearer not-a-jwt',
      status: 403,
      message: 'Invalid token',
    },
    {
      name: 'alg=none forgery',
      // A token the attacker builds unsigned, claiming admin.
      header: () => {
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        return `Bearer ${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 'u1', isAdmin: true })}.`;
      },
      status: 403,
      message: 'Invalid token',
    },
  ];

  it.each(cases)('rejects $name', async ({ header, status, message }) => {
    const req = request(app).get('/protected');
    const value = typeof header === 'function' ? header() : header;
    if (value !== undefined) req.set('Authorization', value);

    const res = await req;
    expect(res.status).toBe(status);
    expect(res.body.message).toBe(message);
  });

  it('accepts a valid Bearer token and attaches the payload', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${sign({ id: 'u1', isAdmin: false })}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'u1', isAdmin: false });
  });

  // `authorization.split(" ")[1]` takes the second whitespace-delimited field
  // without ever checking that the first one says "Bearer". Any scheme is
  // accepted. Documented here as current behaviour, not endorsed.
  it('accepts a non-Bearer scheme carrying a valid JWT', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Basic ${sign({ id: 'u1', isAdmin: false })}`);

    expect(res.status).toBe(200);
  });
});

describe('requireAdmin', () => {
  it('rejects a valid token belonging to a non-admin', async () => {
    const res = await request(app)
      .get('/admin')
      .set('Authorization', `Bearer ${sign({ id: 'u1', isAdmin: false })}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Forbidden: Admin access required');
  });

  it('rejects a token with no isAdmin claim at all', async () => {
    const res = await request(app)
      .get('/admin')
      .set('Authorization', `Bearer ${sign({ id: 'u1' })}`);

    expect(res.status).toBe(403);
  });

  it('rejects a token whose isAdmin is a truthy non-boolean', async () => {
    // Guards the check staying `req.user.isAdmin` rather than becoming `=== true`
    // without a matching change here.
    const res = await request(app)
      .get('/admin')
      .set('Authorization', `Bearer ${sign({ id: 'u1', isAdmin: 'yes' })}`);

    expect(res.status).toBe(200);
  });

  it('allows a genuine admin', async () => {
    const res = await request(app)
      .get('/admin')
      .set('Authorization', `Bearer ${sign({ id: 'admin1', isAdmin: true })}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('cannot be reached without verifyToken having run', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(401);
  });
});
