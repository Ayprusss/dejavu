/**
 * The two concurrency guarantees, with the interleaving forced rather than
 * hoped for.
 *
 * The HTTP-level tests in webhook.test.js fire deliveries with `Promise.all`,
 * which is not enough on its own: each transaction is fast enough that the
 * first usually commits before the second opens, so those tests pass against
 * an implementation with no concurrency control at all. Verified — swapping the
 * `ON CONFLICT` claim for a read-then-write left all fifteen of them green.
 *
 * So the guarantees are pinned here instead, by driving two explicit
 * connections and committing the first only once the second is provably
 * blocked. Both tests fail against the implementations these replaced.
 */

const pool = require('../../src/db/pool');
const stripeEventRepo = require('../../src/repositories/stripeEventRepo');
const variantRepo = require('../../src/repositories/variantRepo');
const { resetDatabase, seedCatalog, stockOf } = require('./helpers');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Return clients to the pool, rolling back anything still open.
 *
 * `client.release()` does not roll back. When one of these tests fails
 * mid-transaction its client goes back to the pool still inside an aborted
 * transaction, and the *next* test to borrow it dies with "current transaction
 * is aborted" — one real failure reported as two, with the second pointing at
 * innocent code.
 */
const release = async (...clients) => {
  for (const client of clients) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
};

/**
 * Long enough for the second connection to have issued its statement and be
 * parked on the lock. It gates nothing but the moment of COMMIT, so a slow
 * machine makes this wait pointlessly, never wrongly.
 */
const LOCK_SETTLE_MS = 150;

let variants;

beforeEach(async () => {
  await resetDatabase();
  ({ variants } = await seedCatalog({ stock: { S: 1, M: 1, L: 1 } }));
});

describe('StripeEvent claim under a genuine race', () => {
  it('gives the event to exactly one of two overlapping transactions', async () => {
    const a = await pool.connect();
    const b = await pool.connect();

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      // A claims the id and holds the row uncommitted.
      const claimedByA = await stripeEventRepo.recordOnce(a, {
        id: 'evt_race',
        type: 'checkout.session.completed',
      });
      expect(claimedByA).not.toBeNull();

      // B tries the same id. Its INSERT parks on A's uncommitted primary key.
      const bClaim = stripeEventRepo.recordOnce(b, {
        id: 'evt_race',
        type: 'checkout.session.completed',
      });
      await sleep(LOCK_SETTLE_MS);

      await a.query('COMMIT');

      // The assertion that matters: B is told "already taken", not handed an
      // error. A read-then-write raises 23505 here, because B's SELECT ran
      // against a snapshot in which the row did not yet exist.
      await expect(bClaim).resolves.toBeNull();

      await b.query('COMMIT');
    } finally {
      await release(a, b);
    }

    const { rows } = await pool.query('SELECT * FROM "StripeEvent"');
    expect(rows).toHaveLength(1);
  });
});

describe('stock decrement under a genuine race', () => {
  it('lets exactly one of two overlapping transactions take the last unit', async () => {
    const variantId = variants.L.id; // stock 1
    const a = await pool.connect();
    const b = await pool.connect();

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      const takenByA = await variantRepo.decrementStock(a, variantId, 1);
      expect(takenByA).not.toBeNull();
      expect(takenByA.stock).toBe(0);

      // B's UPDATE blocks on A's row lock. Note a read-modify-write would NOT
      // block here — MVCC lets its SELECT read the pre-update snapshot and see
      // a stock of 1, which is precisely the lost update.
      const bTake = variantRepo.decrementStock(b, variantId, 1);
      await sleep(LOCK_SETTLE_MS);

      await a.query('COMMIT');

      // B re-evaluates `stock >= 1` against the committed row and matches
      // nothing. A read-modify-write instead writes its stale `1 - 1` and
      // reports success, selling the same unit twice.
      await expect(bTake).resolves.toBeNull();

      await b.query('COMMIT');
    } finally {
      await release(a, b);
    }

    expect(await stockOf(variantId)).toBe(0);
  });

  it('refuses to take more than is left', async () => {
    const variantId = variants.M.id; // stock 1

    expect(await variantRepo.decrementStock(pool, variantId, 2)).toBeNull();
    expect(await stockOf(variantId)).toBe(1);
  });

  it('cannot drive stock below zero even when called repeatedly', async () => {
    const variantId = variants.S.id; // stock 1

    const results = await Promise.all([
      variantRepo.decrementStock(pool, variantId, 1),
      variantRepo.decrementStock(pool, variantId, 1),
      variantRepo.decrementStock(pool, variantId, 1),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await stockOf(variantId)).toBe(0);
  });
});
