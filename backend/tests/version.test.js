const request = require('supertest');
const app = require('../src/app');

/**
 * Touches no database, unlike /api/ready — the pg.Pool import doesn't connect
 * until something queries it, so this is safe to run in the unit suite.
 */
describe('GET /api/version', () => {
  it('reports GIT_SHA, defaulting to "unknown" when unset', async () => {
    const res = await request(app).get('/api/version');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sha: 'unknown' });
  });
});
