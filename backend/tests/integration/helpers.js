/**
 * Shared machinery for the integration suite: database reset, fixtures, and
 * signed Stripe webhook deliveries.
 */

const request = require('supertest');
const bcrypt = require('bcrypt');
const pool = require('../../src/db/pool');
const stripe = require('../../src/stripe');
const app = require('../../src/app');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/** Every table, in one statement. CASCADE handles the foreign keys. */
const TABLES = [
  'OrderItem',
  'Order',
  'ProductVariant',
  'Product',
  'User',
  'StripeEvent',
];

/**
 * Wipe every table between tests.
 *
 * TRUNCATE rather than DELETE because it does not scan, and RESTART IDENTITY so
 * a sequence added later cannot make tests order-dependent. This is why the
 * suite runs single-fork: a parallel worker writing during someone else's
 * TRUNCATE is a flake nobody enjoys diagnosing.
 */
const resetDatabase = async () => {
  await pool.query(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
};

const query = async (sql, params) => (await pool.query(sql, params)).rows;

/**
 * A product with three sizes, plus a registered customer and an admin.
 *
 * All three variants share one `stripeProductId`, which the schema only permits
 * because migration 0002 replaced the wrong UNIQUE. Seeding it this way means
 * the fixture itself would fail if that migration were reverted.
 */
const seedCatalog = async ({ stock = { S: 5, M: 10, L: 1 } } = {}) => {
  const [product] = await query(
    `INSERT INTO "Product" ("stripeProductId","name","description","price","images")
     VALUES ('prod_test_1','Isaac Tech Chino Pants in Tan','{"heading":"Cotton"}',630,'{a.webp,b.webp}')
     RETURNING *`,
  );

  const variants = {};
  for (const [size, count] of Object.entries(stock)) {
    const [variant] = await query(
      `INSERT INTO "ProductVariant" ("stripeProductId","productId","size","stock")
       VALUES ('prod_test_1',$1,$2,$3) RETURNING *`,
      [product.id, size, count],
    );
    variants[size] = variant;
  }

  return { product, variants };
};

/** Password for every seeded account. */
const PASSWORD = 'password123';

const seedUser = async ({ email, isAdmin = false }) => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: tests, not storage
  const [user] = await query(
    `INSERT INTO "User" ("email","passwordHash","firstName","lastName","isAdmin")
     VALUES ($1,$2,'Test','User',$3) RETURNING *`,
    [email, passwordHash, isAdmin],
  );
  return user;
};

/** Log in through the real endpoint so the token is one the app actually issues. */
const loginAs = async (email) => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(
      `loginAs(${email}) failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.token;
};

const stockOf = async (variantId) => {
  const rows = await query('SELECT "stock" FROM "ProductVariant" WHERE "id" = $1', [
    variantId,
  ]);
  return rows[0]?.stock ?? null;
};

// --------------------------------------------------------------------------
// Stripe webhook fixtures
// --------------------------------------------------------------------------

/** One Stripe line item carrying the variantId the webhook reads. */
const lineItem = (variantId, quantity, unitDollars = 630) => ({
  quantity,
  amount_total: Math.round(unitDollars * 100) * quantity,
  price: { product: { metadata: variantId ? { variantId } : {} } },
});

const checkoutCompletedEvent = ({
  id,
  sessionId,
  email = 'buyer@example.com',
  totalDollars = 630,
  address = { city: 'Boston', line1: '1 Main St', country: 'US', postal_code: '02101' },
} = {}) => ({
  id,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: sessionId,
      amount_total: Math.round(totalDollars * 100),
      customer_details: email ? { email } : {},
      shipping_details: address ? { address } : undefined,
    },
  },
});

/**
 * POST a properly signed event at the webhook.
 *
 * The body is sent as a **string**. `.send(Buffer.from(payload))` under a JSON
 * content type makes superagent serialise the Buffer object itself, so the
 * handler receives `{"type":"Buffer","data":[...]}` and every signature check
 * fails — which looks exactly like a broken signature implementation.
 */
const deliverEvent = (event, { secret = WEBHOOK_SECRET } = {}) => {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

  return request(app)
    .post('/api/webhooks/stripe')
    .set('stripe-signature', signature)
    .set('content-type', 'application/json')
    .send(payload);
};

/** Make the handler's one Stripe network call return these line items. */
const stubLineItems = (items) =>
  vi
    .spyOn(stripe.checkout.sessions, 'listLineItems')
    .mockResolvedValue({ data: items });

/**
 * Like `stubLineItems`, but holds every caller until `count` of them have
 * arrived, then releases them together.
 *
 * Without this, "concurrent" tests are not concurrent. `Promise.all` starts
 * both requests, but the stub resolves on the microtask queue, so the first
 * delivery usually runs its whole transaction to completion before the second
 * one opens its own — and the test passes against an implementation with no
 * concurrency control at all. Verified: replacing the `ON CONFLICT` claim with
 * a read-then-write passed all fifteen tests until this barrier existed.
 *
 * Releasing both here puts both transactions in flight at once, so the database
 * has to be the thing that arbitrates.
 */
const stubLineItemsWithBarrier = (items, count) => {
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  return vi
    .spyOn(stripe.checkout.sessions, 'listLineItems')
    .mockImplementation(async () => {
      arrived += 1;
      if (arrived >= count) release();
      await gate;
      return { data: items };
    });
};

module.exports = {
  app,
  pool,
  request,
  query,
  resetDatabase,
  seedCatalog,
  seedUser,
  loginAs,
  stockOf,
  PASSWORD,
  lineItem,
  checkoutCompletedEvent,
  deliverEvent,
  stubLineItems,
  stubLineItemsWithBarrier,
};
