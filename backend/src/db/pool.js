/**
 * The single `pg.Pool` for the process.
 *
 * Nothing outside `src/db` and `src/repositories` should import this directly —
 * controllers receive an executor (this pool, or a transaction client) and pass
 * it to repository functions.
 */

const pg = require('pg');
const env = require('../config/env');

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
  connectionString: env.DATABASE_URL,
  // Load-bearing in Phase 6: a Lambda holds one connection per warm instance,
  // so the per-process ceiling has to come down when concurrency goes up.
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// An error on an idle client is emitted on the pool, not on any query. Without
// a listener this takes the process down.
pool.on('error', (error) => {
  console.error('Unexpected error on idle database client:', error);
});

module.exports = pool;
