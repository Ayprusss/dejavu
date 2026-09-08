/**
 * Order and OrderItem queries. See userRepo for the executor convention.
 *
 * The functions returning nested items replace the deep PostgREST embedded
 * selects, which have no direct SQL equivalent. Each one rebuilds the exact
 * JSON the frontend already destructures — `OrderItem` as an array,
 * `ProductVariant` and `Product` as objects, `User` as an object or null — so
 * the rewrite is invisible above the repository. The per-query field lists are
 * kept as narrow as the PostgREST select they replace; widening one is a
 * deliberate change, not a tidy-up.
 */

/** OrderItem(*, ProductVariant(size, Product(name))) — adminController. */
const ITEMS_FOR_ADMIN = `
  COALESCE(
    (
      SELECT jsonb_agg(
               to_jsonb(oi) || jsonb_build_object(
                 'ProductVariant',
                 (
                   SELECT jsonb_build_object(
                            'size', v."size",
                            'Product', (
                              SELECT jsonb_build_object('name', p."name")
                              FROM "Product" p
                              WHERE p."id" = v."productId"
                            )
                          )
                   FROM "ProductVariant" v
                   WHERE v."id" = oi."variantId"
                 )
               )
               ORDER BY oi."createdAt"
             )
      FROM "OrderItem" oi
      WHERE oi."orderId" = o."id"
    ),
    '[]'::jsonb
  ) AS "OrderItem"`;

/**
 * OrderItem(id, quantity, priceAtSale, ProductVariant(id, size, Product(id,
 * name, images))) — userController.
 */
const ITEMS_FOR_ACCOUNT = `
  COALESCE(
    (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'id', oi."id",
                 'quantity', oi."quantity",
                 'priceAtSale', oi."priceAtSale",
                 'ProductVariant', (
                   SELECT jsonb_build_object(
                            'id', v."id",
                            'size', v."size",
                            'Product', (
                              SELECT jsonb_build_object(
                                       'id', p."id",
                                       'name', p."name",
                                       'images', p."images"
                                     )
                              FROM "Product" p
                              WHERE p."id" = v."productId"
                            )
                          )
                   FROM "ProductVariant" v
                   WHERE v."id" = oi."variantId"
                 )
               )
               ORDER BY oi."createdAt"
             )
      FROM "OrderItem" oi
      WHERE oi."orderId" = o."id"
    ),
    '[]'::jsonb
  ) AS "OrderItem"`;

/**
 * OrderItem(id, quantity, priceAtSale, ProductVariant(size, Product(name,
 * images))) — the checkout success page.
 */
const ITEMS_FOR_CHECKOUT = `
  COALESCE(
    (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'id', oi."id",
                 'quantity', oi."quantity",
                 'priceAtSale', oi."priceAtSale",
                 'ProductVariant', (
                   SELECT jsonb_build_object(
                            'size', v."size",
                            'Product', (
                              SELECT jsonb_build_object(
                                       'name', p."name",
                                       'images', p."images"
                                     )
                              FROM "Product" p
                              WHERE p."id" = v."productId"
                            )
                          )
                   FROM "ProductVariant" v
                   WHERE v."id" = oi."variantId"
                 )
               )
               ORDER BY oi."createdAt"
             )
      FROM "OrderItem" oi
      WHERE oi."orderId" = o."id"
    ),
    '[]'::jsonb
  ) AS "OrderItem"`;

/** Null for a guest order, which is what PostgREST returned here too. */
const EMBEDDED_USER = `
  (
    SELECT jsonb_build_object(
             'email', u."email",
             'firstName', u."firstName",
             'lastName', u."lastName"
           )
    FROM "User" u
    WHERE u."id" = o."userId"
  ) AS "User"`;

/** Every order with its customer and items, newest first. adminController. */
const findAllWithUserAndItems = async (db) => {
  const { rows } = await db.query(
    `SELECT o.*, ${EMBEDDED_USER}, ${ITEMS_FOR_ADMIN}
     FROM "Order" o
     ORDER BY o."createdAt" DESC`,
  );
  return rows;
};

/** One account's orders with items, newest first. userController. */
const findByUserIdWithItems = async (db, userId) => {
  const { rows } = await db.query(
    `SELECT o.*, ${ITEMS_FOR_ACCOUNT}
     FROM "Order" o
     WHERE o."userId" = $1
     ORDER BY o."createdAt" DESC`,
    [userId],
  );
  return rows;
};

/** The checkout success page. Null while the webhook is still behind. */
const findByStripeSessionIdWithItems = async (db, stripeSessionId) => {
  const { rows } = await db.query(
    `SELECT
        o."id",
        o."stripeSessionId",
        o."customerEmail",
        o."totalAmount",
        o."status",
        o."shippingAddress",
        o."createdAt",
        ${ITEMS_FOR_CHECKOUT}
     FROM "Order" o
     WHERE o."stripeSessionId" = $1`,
    [stripeSessionId],
  );
  return rows[0] ?? null;
};

/** Idempotency probe for the webhook: id only, no joins. */
const findIdByStripeSessionId = async (db, stripeSessionId) => {
  const { rows } = await db.query(
    `SELECT "id" FROM "Order" WHERE "stripeSessionId" = $1`,
    [stripeSessionId],
  );
  return rows[0] ?? null;
};

const insert = async (
  db,
  {
    id,
    stripeSessionId,
    userId = null,
    customerEmail = null,
    totalAmount,
    status = 'PENDING',
    shippingAddress = null,
  },
) => {
  // `shippingAddress` is passed as an object and serialised by the driver. The
  // Supabase path called JSON.stringify on it first, which stored a JSON
  // *string* inside the jsonb column — any row written before this rewrite is
  // double-encoded relative to rows written after it.
  const { rows } = await db.query(
    `INSERT INTO "Order"
        ("id", "stripeSessionId", "userId", "customerEmail", "totalAmount",
         "status", "shippingAddress")
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id ?? null,
      stripeSessionId,
      userId,
      customerEmail,
      totalAmount,
      status,
      shippingAddress,
    ],
  );
  return rows[0];
};

const insertItem = async (db, { id, orderId, variantId, quantity, priceAtSale }) => {
  const { rows } = await db.query(
    `INSERT INTO "OrderItem"
        ("id", "orderId", "variantId", "quantity", "priceAtSale")
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5)
     RETURNING *`,
    [id ?? null, orderId, variantId, quantity, priceAtSale],
  );
  return rows[0];
};

/** Returns the updated row, or null when no order has that id. */
const updateStatusById = async (db, id, status) => {
  const { rows } = await db.query(
    `UPDATE "Order" SET "status" = $2 WHERE "id" = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] ?? null;
};

/**
 * Claim a new account's guest orders. Matched case-insensitively, in step with
 * the unique index from migration 0007 — the previous exact match missed any
 * order placed under a different capitalisation of the same address.
 */
const linkGuestOrdersToUser = async (db, { email, userId }) => {
  const { rowCount } = await db.query(
    `UPDATE "Order"
     SET "userId" = $2
     WHERE lower("customerEmail") = lower($1) AND "userId" IS NULL`,
    [email, userId],
  );
  return rowCount;
};

module.exports = {
  findAllWithUserAndItems,
  findByUserIdWithItems,
  findByStripeSessionIdWithItems,
  findIdByStripeSessionId,
  insert,
  insertItem,
  updateStatusById,
  linkGuestOrdersToUser,
};
