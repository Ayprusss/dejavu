/**
 * pool.js's retry-once on 28P01 (issue #22), without a database.
 *
 * Only pg-pool's own `connect` is stubbed, on the prototype and before pool.js
 * is required, so pool.js wraps the stub exactly as it wraps the real thing.
 * `pool.query` is pg-pool's real implementation: it acquires through
 * `this.connect(cb)` (callback style), which is how the retry reaches every
 * `pool.query` in the app. The stub answers both styles, like pg-pool does.
 *
 * As in dbCredentials.test.js, `require.cache` is the stubbing mechanism:
 * `vi.mock` doesn't reach a CommonJS `require` inside src/.
 */
const pg = require('pg');

const credentialsPath = require.resolve('../src/db/credentials');
const invalidate = vi.fn();
require.cache[credentialsPath] = {
  id: credentialsPath,
  filename: credentialsPath,
  loaded: true,
  exports: { getDbPassword: vi.fn(), invalidate },
};

// Each connect attempt takes the next outcome: an Error, or a fake client.
const outcomes = [];
const originalPrototypeConnect = pg.Pool.prototype.connect;
const connect = vi.fn(function fakeConnect(callback) {
  const next = outcomes.shift();
  const failed = next instanceof Error;
  if (callback) {
    setImmediate(() =>
      failed
        ? callback(next, undefined, () => {})
        : callback(undefined, next, next.release),
    );
    return undefined;
  }
  return failed ? Promise.reject(next) : Promise.resolve(next);
});
pg.Pool.prototype.connect = connect;

const pool = require('../src/db/pool');

afterAll(() => {
  pg.Pool.prototype.connect = originalPrototypeConnect;
});

const authFailed = () =>
  Object.assign(new Error('password authentication failed for user "dejavu_admin"'), {
    code: '28P01',
  });

// Just enough of a pg Client for pg-pool's `query` to drive it. `statement`
// counts how many times a statement actually reached the "database".
const fakeClient = ({ statementError } = {}) => {
  const client = {
    statement: vi.fn((text, values, callback) =>
      setImmediate(() =>
        statementError
          ? callback(statementError)
          : callback(undefined, { rows: [{ ok: 1 }] }),
      ),
    ),
    once: vi.fn(),
    removeListener: vi.fn(),
    release: vi.fn(),
  };
  client.query = client.statement;
  return client;
};

beforeEach(() => {
  outcomes.length = 0;
  connect.mockClear();
  invalidate.mockClear();
});

describe('db/pool pool.query on 28P01', () => {
  it('invalidates the cached password and retries the connection once', async () => {
    const client = fakeClient();
    outcomes.push(authFailed(), client);

    await expect(pool.query('SELECT 1')).resolves.toEqual({ rows: [{ ok: 1 }] });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(client.statement).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once in total, then surfaces a second 28P01', async () => {
    outcomes.push(authFailed(), authFailed(), fakeClient());

    await expect(pool.query('SELECT 1')).rejects.toMatchObject({ code: '28P01' });

    // Two, not three or four: no second retry layered on top.
    expect(connect).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('does not retry any other connection error', async () => {
    outcomes.push(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      fakeClient(),
    );

    await expect(pool.query('SELECT 1')).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('never re-issues a statement, whatever error it returns', async () => {
    // A statement error is never retried, even one carrying 28P01: once a
    // statement has been sent, it may have executed.
    const client = fakeClient({ statementError: authFailed() });
    outcomes.push(client, fakeClient());

    await expect(
      pool.query('UPDATE "ProductVariant" SET stock = stock - 1'),
    ).rejects.toMatchObject({ code: '28P01' });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.statement).toHaveBeenCalledTimes(1);
  });

  it('does nothing extra when the first connection succeeds', async () => {
    outcomes.push(fakeClient());

    await pool.query('SELECT 1');

    expect(connect).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('db/pool pool.connect on 28P01 (withTransaction path)', () => {
  it('invalidates and retries once, handing the caller the new client', async () => {
    const client = fakeClient();
    outcomes.push(authFailed(), client);

    await expect(pool.connect()).resolves.toBe(client);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a second 28P01 instead of retrying again', async () => {
    outcomes.push(authFailed(), authFailed(), fakeClient());

    await expect(pool.connect()).rejects.toMatchObject({ code: '28P01' });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('does not retry any other connection error', async () => {
    outcomes.push(new Error('timeout exceeded when trying to connect'), fakeClient());

    await expect(pool.connect()).rejects.toThrow('timeout exceeded');

    expect(connect).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
