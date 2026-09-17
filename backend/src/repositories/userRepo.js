/**
 * User queries.
 *
 * Every function takes the executor as its first argument — either the pool
 * (for a standalone statement) or a transaction client from `withTransaction`.
 * Nothing here opens its own connection, which is what lets a caller compose
 * several of these into one atomic unit.
 *
 * Email is matched on `lower(email)` to line up with the unique index added in
 * migration 0007.
 */

const findByEmail = async (db, email) => {
  const { rows } = await db.query(
    `SELECT * FROM "User" WHERE lower("email") = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
};

const findById = async (db, id) => {
  const { rows } = await db.query(`SELECT * FROM "User" WHERE "id" = $1`, [id]);
  return rows[0] ?? null;
};

const insert = async (
  db,
  { email, passwordHash, firstName, lastName, isAdmin = false },
) => {
  const { rows } = await db.query(
    `INSERT INTO "User" ("email", "passwordHash", "firstName", "lastName", "isAdmin")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [email, passwordHash, firstName, lastName, isAdmin],
  );
  return rows[0];
};

/**
 * Set (or clear) `isAdmin` on an existing user by id.
 *
 * Used by the migrator's `grant-admin` action — the caller has already
 * looked the user up by email, so this takes the id rather than repeating the
 * `lower(email)` match.
 */
const setAdminById = async (db, id, isAdmin) => {
  const { rows } = await db.query(
    `UPDATE "User" SET "isAdmin" = $2 WHERE "id" = $1 RETURNING *`,
    [id, isAdmin],
  );
  return rows[0] ?? null;
};

module.exports = { findByEmail, findById, insert, setAdminById };
