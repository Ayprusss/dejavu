/**
 * Run `fn` inside a single database transaction.
 *
 * The client is passed to `fn` as the executor, so every repository call made
 * with it joins the same transaction:
 *
 *   await withTransaction(pool, async (tx) => {
 *     const order = await orderRepo.insert(tx, { ... });
 *     await variantRepo.decrementStock(tx, variantId, quantity);
 *   });
 *
 * Commits on return, rolls back on throw, and always releases the client. The
 * rollback is itself guarded: if the connection died mid-transaction the
 * ROLLBACK will throw too, and letting that escape would replace the real error
 * with a meaningless one.
 */
const withTransaction = async (pool, fn) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to roll back transaction:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
};

module.exports = withTransaction;
