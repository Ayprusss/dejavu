/**
 * StripeEvent — the webhook's idempotency ledger. See userRepo for the executor
 * convention.
 */

/**
 * Claim a Stripe event id, exactly once.
 *
 * Returns the row on the first delivery and `null` on every delivery after it.
 * The uniqueness is enforced by the primary key rather than by a preceding
 * SELECT, which matters for two reasons:
 *
 *   - A read-then-write is not atomic. Two deliveries of the same event racing
 *     each other both read "not present" and both proceed. `ON CONFLICT` makes
 *     the database arbitrate, and the loser gets zero rows.
 *   - It cannot mistake an error for an absence. The previous check discarded
 *     the query error, so a transient failure read as "no existing order" and
 *     reprocessed the event.
 *
 * Call this inside the same transaction as the work it guards, so that a
 * rollback releases the claim and the event can be retried.
 */
const recordOnce = async (db, { id, type }) => {
  const { rows } = await db.query(
    `INSERT INTO "StripeEvent" ("id", "type")
     VALUES ($1, $2)
     ON CONFLICT ("id") DO NOTHING
     RETURNING *`,
    [id, type],
  );
  return rows[0] ?? null;
};

module.exports = { recordOnce };
