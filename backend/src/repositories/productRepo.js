/**
 * Product queries. See userRepo for the executor convention.
 *
 * `findAll` / `findById` reproduce the PostgREST select `Product(*,
 * ProductVariant(*))`: the variants arrive under the key `ProductVariant` as an
 * array, empty rather than null when a product has none. Shop.jsx, ShopItem.jsx
 * and AdminDashboard.jsx all read that key directly.
 */

/** Columns `updateById` will write. Anything else in the body is ignored. */
const UPDATABLE_COLUMNS = [
  'stripeProductId',
  'name',
  'description',
  'price',
  'images',
  'status',
  'sizeGuide',
];

const WITH_VARIANTS = `
  SELECT
      p.*,
      COALESCE(
        (
          SELECT jsonb_agg(to_jsonb(v) ORDER BY v."size")
          FROM "ProductVariant" v
          WHERE v."productId" = p."id"
        ),
        '[]'::jsonb
      ) AS "ProductVariant"
  FROM "Product" p`;

const findAllWithVariants = async (db) => {
  const { rows } = await db.query(`${WITH_VARIANTS} ORDER BY p."createdAt"`);
  return rows;
};

const findByIdWithVariants = async (db, id) => {
  const { rows } = await db.query(`${WITH_VARIANTS} WHERE p."id" = $1`, [id]);
  return rows[0] ?? null;
};

const findByStripeProductIdWithVariants = async (db, stripeProductId) => {
  const { rows } = await db.query(`${WITH_VARIANTS} WHERE p."stripeProductId" = $1`, [
    stripeProductId,
  ]);
  return rows[0] ?? null;
};

const insert = async (
  db,
  { stripeProductId, name, description, price, images, sizeGuide = null },
) => {
  const { rows } = await db.query(
    `INSERT INTO "Product"
        ("stripeProductId", "name", "description", "price", "images", "sizeGuide")
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [stripeProductId, name, description, price, images, sizeGuide],
  );
  return rows[0];
};

/**
 * Narrow an arbitrary request body to the columns that may be written.
 *
 * Column names cannot be parameterised, so they are interpolated into the SQL —
 * which is safe only because they come from UPDATABLE_COLUMNS and never from
 * the caller. Exported so the controller can reject an empty update with a 400
 * instead of issuing a no-op statement.
 */
const pickUpdatable = (updates = {}) =>
  Object.fromEntries(
    Object.entries(updates).filter(([column]) => UPDATABLE_COLUMNS.includes(column)),
  );

/** Returns the updated row, or null when no product has that id. */
const updateById = async (db, id, updates) => {
  const fields = pickUpdatable(updates);
  const columns = Object.keys(fields);

  if (columns.length === 0) {
    throw new Error('updateById called with no updatable columns');
  }

  // $1 is the id, so values start at $2. `updatedAt` is the trigger's job.
  const assignments = columns.map((column, index) => `"${column}" = $${index + 2}`);

  const { rows } = await db.query(
    `UPDATE "Product" SET ${assignments.join(', ')} WHERE "id" = $1 RETURNING *`,
    [id, ...columns.map((column) => fields[column])],
  );
  return rows[0] ?? null;
};

module.exports = {
  UPDATABLE_COLUMNS,
  findAllWithVariants,
  findByIdWithVariants,
  findByStripeProductIdWithVariants,
  insert,
  pickUpdatable,
  updateById,
};
