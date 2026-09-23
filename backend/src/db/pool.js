/**
 * The single `pg.Pool` for the process.
 *
 * Nothing outside `src/db` and `src/repositories` should import this directly —
 * controllers receive an executor (this pool, or a transaction client) and pass
 * it to repository functions.
 */

const pg = require('pg');
const env = require('../config/env');
const logger = require('../lib/logger');
const { invalidate } = require('./credentials');
const buildConnectionOptions = require('./connectionOptions');

/**
 * Return `numeric` as a JS number instead of a string.
 *
 * node-postgres hands back `numeric` (OID 1700) as a string to avoid losing
 * precision, which is the right default for a general driver and the wrong one
 * here: supabase-js returned JSON numbers, and the frontend consumes them as
 * such — `Account.jsx` calls `order.totalAmount.toFixed(2)` directly, which
 * throws on a string.
 *
 * Safe at this scale: prices are decimal dollars well inside the range a double
 * represents exactly to the cent, and money is converted to integer cents via
 * `lib/money.toCents` before it is ever charged. It would not be safe for
 * accumulating balances, which this schema does not have.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

const pool = new pg.Pool({
  ...buildConnectionOptions(),
  // Load-bearing in Phase 6: a Lambda holds one connection per warm instance,
  // so the per-process ceiling has to come down when concurrency goes up.
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// An error on an idle client is emitted on the pool, not on any query. Without
// a listener this takes the process down.
pool.on('error', (error) => {
  logger.error(
    { event: 'db.idle_client_error', err: error },
    'Unexpected error on idle database client',
  );

  // 28P01 = invalid_password. The rotation window from correction 3: a cached
  // password went stale mid-rotation. Invalidate so the *next* connection
  // attempt re-fetches instead of repeating the same failure.
  if (error.code === '28P01') invalidate();
});

/**
 * `pool.on('error', ...)` above only fires for a client that had already
 * connected and then failed while idle — not for a brand-new connection
 * attempt that fails at auth time, which is the actual rotation scenario
 * (the pool opens a fresh connection and the cached password is stale). That
 * error comes back from connection acquisition instead, so it is caught here,
 * around `pool.connect`, the one place both paths go through: pg-pool's own
 * `pool.query` acquires its client via `this.connect(cb)`, which is this
 * wrapper.
 *
 * After invalidating, the *connection* is retried once (issue #22). 28P01 is
 * raised during the startup/auth handshake of a new physical connection,
 * before any statement is sent, so retrying acquisition can never run a
 * statement twice. No client has been handed out yet either, so there is no
 * caller transaction to be inside. The retry re-fetches the password (the
 * cache was just cleared), which turns 6.10 run 2's stale-cache blip into one
 * slower request instead of a 5xx. Exactly once: if the re-fetched secret is
 * still the old one (rotation in progress, `AWSCURRENT` not yet moved), the
 * second 28P01 goes to the caller as before.
 *
 * Deliberately not wrapped: `pool.query` or `client.query`, where an error can
 * arrive after the statement executed. Only acquisition is retried.
 */
const originalConnect = pool.connect.bind(pool);

const logAuthRetry = () =>
  logger.warn(
    { event: 'db.auth_retry' },
    'Database auth failed (28P01); retrying the connection once with a re-fetched password',
  );

pool.connect = (callback) => {
  // Callback style: pg-pool's `pool.query` calls `this.connect(cb)` and gets
  // `(err, client, release)` back. Forward whatever the pool hands over.
  if (typeof callback === 'function') {
    let retried = false;
    const onConnect = (error, ...rest) => {
      if (error?.code === '28P01') {
        invalidate();
        if (!retried) {
          retried = true;
          logAuthRetry();
          return originalConnect(onConnect);
        }
      }
      return callback(error, ...rest);
    };
    return originalConnect(onConnect);
  }

  // Promise style: `withTransaction`, and anything else awaiting a client.
  return originalConnect().catch((error) => {
    if (error.code !== '28P01') throw error;
    invalidate();
    logAuthRetry();
    return originalConnect().catch((retryError) => {
      if (retryError.code === '28P01') invalidate();
      throw retryError;
    });
  });
};

module.exports = pool;
