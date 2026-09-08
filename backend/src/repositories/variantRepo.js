/**
 * ProductVariant queries. See userRepo for the executor convention.
 */

/**
 * Variants by id, each with the `Product` object the checkout flow needs.
 *
 * Replaces the PostgREST select `ProductVariant(id, size, stock, Product(name,
 * price))` — the nested key name and shape are what checkoutController and its
 * callers already expect.
 */
const findManyByIdsWithProduct = async (db, ids) => {
  const { rows } = await db.query(
    `SELECT
        v."id",
        v."size",
        v."stock",
        (
          SELECT jsonb_build_object('name', p."name", 'price', p."price")
          FROM "Product" p
          WHERE p."id" = v."productId"
        ) AS "Product"
     FROM "ProductVariant" v
     WHERE v."id" = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
};

const findById = async (db, id) => {
  const { rows } = await db.query(`SELECT * FROM "ProductVariant" WHERE "id" = $1`, [
    id,
  ]);
  return rows[0] ?? null;
};

/**
 * Set stock to an absolute value. `updatedAt` is left to the trigger from
 * migration 0006.
 *
 * This is the admin's manual override. It is deliberately NOT how the webhook
 * decrements stock — that becomes a conditional `WHERE stock >= $n` in Phase 3,
 * because read-then-write through this function is the oversell race.
 */
const updateStockById = async (db, id, stock) => {
  const { rows } = await db.query(
    `UPDATE "ProductVariant" SET "stock" = $2 WHERE "id" = $1 RETURNING *`,
    [id, stock],
  );
  return rows[0] ?? null;
};

module.exports = { findManyByIdsWithProduct, findById, updateStockById };
