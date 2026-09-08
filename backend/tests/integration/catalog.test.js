/**
 * The catalog and auth endpoints, and the response shapes the frontend
 * destructures.
 *
 * The shape assertions are the point of this file. `Account.jsx` reads
 * `order.OrderItem[].ProductVariant.Product`, `Shop.jsx` reads
 * `product.ProductVariant[]`, `AdminDashboard.jsx` reads `order.User?.email` —
 * so the PostgREST key names the SQL rewrite reproduces are a contract, and
 * breaking one shows up as a blank page rather than a failing request.
 */

const {
  app,
  request,
  query,
  resetDatabase,
  seedCatalog,
  seedUser,
  loginAs,
  PASSWORD,
} = require('./helpers');

let product;
let variants;

beforeEach(async () => {
  await resetDatabase();
  ({ product, variants } = await seedCatalog());
});

describe('GET /api/products', () => {
  it('nests variants under the PostgREST key name, as an array', async () => {
    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const [item] = res.body;
    expect(Array.isArray(item.ProductVariant)).toBe(true);
    expect(item.ProductVariant).toHaveLength(3);
    expect(item.ProductVariant.map((v) => v.size).sort()).toEqual(['L', 'M', 'S']);
  });

  it('returns price as a number and images as an array', async () => {
    const [item] = (await request(app).get('/api/products')).body;

    // node-postgres hands back `numeric` as a string; `Account.jsx` calls
    // `.toFixed()` on these directly, so the type is load-bearing.
    expect(typeof item.price).toBe('number');
    expect(item.price).toBe(630);
    expect(Array.isArray(item.images)).toBe(true);
  });

  it('gives a product with no variants an empty array, not null', async () => {
    await query(
      `INSERT INTO "Product" ("stripeProductId","name","description","price","images")
       VALUES ('prod_bare','Bare','d',10,'{x.webp}')`,
    );

    const res = await request(app).get('/api/products');
    const bare = res.body.find((p) => p.stripeProductId === 'prod_bare');

    expect(bare.ProductVariant).toEqual([]);
  });
});

describe('GET /api/products/:id', () => {
  it('accepts a UUID', async () => {
    const res = await request(app).get(`/api/products/${product.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(product.id);
  });

  it('accepts a Stripe product id', async () => {
    const res = await request(app).get(`/api/products/${product.stripeProductId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(product.id);
  });

  it('404s on a non-UUID id rather than erroring', async () => {
    // Passing this straight to a uuid column is a 22P02 from Postgres, where
    // PostgREST simply returned no rows — so the branch that decides which
    // column to match on is what keeps this a 404 and not a 500.
    const res = await request(app).get('/api/products/prod_does_not_exist');
    expect(res.status).toBe(404);
  });

  it('404s on a well-formed but unknown UUID', async () => {
    const res = await request(app).get(
      '/api/products/00000000-0000-4000-8000-000000000000',
    );
    expect(res.status).toBe(404);
  });
});

describe('auth', () => {
  it('registers, normalises the email, and never returns the hash', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'MixedCase@Example.COM',
      password: PASSWORD,
      firstName: 'A',
      lastName: 'B',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('mixedcase@example.com');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a duplicate that differs only by case', async () => {
    await seedUser({ email: 'taken@example.com' });

    const res = await request(app).post('/api/auth/register').send({
      email: 'TAKEN@example.com',
      password: PASSWORD,
      firstName: 'A',
      lastName: 'B',
    });

    expect(res.status).toBe(409);
  });

  it('logs in regardless of how the address is capitalised', async () => {
    await seedUser({ email: 'user@example.com' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'USER@Example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('answers a wrong password and an unknown account identically', async () => {
    await seedUser({ email: 'user@example.com' });

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'nope' });
    const noSuchUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(noSuchUser.body);
  });
});

describe('admin', () => {
  it('refuses a valid non-admin token', async () => {
    await seedUser({ email: 'plain@example.com' });
    const token = await loginAs('plain@example.com');

    const res = await request(app)
      .get('/api/admin/orders')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('nests User and OrderItem the way the dashboard reads them', async () => {
    const buyer = await seedUser({ email: 'buyer@example.com' });
    await seedUser({ email: 'boss@example.com', isAdmin: true });

    const [order] = await query(
      `INSERT INTO "Order" ("userId","customerEmail","totalAmount","status","stripeSessionId")
       VALUES ($1,'buyer@example.com',630,'PAID','cs_admin_1') RETURNING *`,
      [buyer.id],
    );
    await query(
      `INSERT INTO "OrderItem" ("orderId","variantId","quantity","priceAtSale")
       VALUES ($1,$2,1,630)`,
      [order.id, variants.M.id],
    );
    await query(
      `INSERT INTO "Order" ("customerEmail","totalAmount","status","stripeSessionId")
       VALUES ('guest@example.com',10,'PAID','cs_admin_guest')`,
    );

    const token = await loginAs('boss@example.com');
    const res = await request(app)
      .get('/api/admin/orders')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const withUser = res.body.find((o) => o.stripeSessionId === 'cs_admin_1');
    expect(withUser.User).toMatchObject({ email: 'buyer@example.com' });
    expect(withUser.OrderItem[0].ProductVariant.Product.name).toBe(
      'Isaac Tech Chino Pants in Tan',
    );

    const guest = res.body.find((o) => o.stripeSessionId === 'cs_admin_guest');
    // null, not {} — AdminDashboard does `order.User?.email`.
    expect(guest.User).toBeNull();
    expect(guest.OrderItem).toEqual([]);
  });

  it('rejects negative stock with a 400 rather than a constraint 500', async () => {
    await seedUser({ email: 'boss@example.com', isAdmin: true });
    const token = await loginAs('boss@example.com');

    const res = await request(app)
      .put(`/api/admin/inventory/${variants.M.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stock: -1 });

    expect(res.status).toBe(400);
  });

  it('updates stock and lets the trigger move updatedAt', async () => {
    await seedUser({ email: 'boss@example.com', isAdmin: true });
    const token = await loginAs('boss@example.com');

    const res = await request(app)
      .put(`/api/admin/inventory/${variants.M.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stock: 42 });

    expect(res.status).toBe(200);
    expect(res.body.variant.stock).toBe(42);
    // Nothing in the controller sets this; migration 0006's trigger does.
    expect(new Date(res.body.variant.updatedAt).getTime()).toBeGreaterThan(
      new Date(variants.M.updatedAt).getTime(),
    );
  });
});

describe('health and errors', () => {
  it('serves liveness and readiness', async () => {
    expect((await request(app).get('/api/status')).status).toBe(200);

    const ready = await request(app).get('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');
  });

  it('answers an unknown route with JSON, not HTML', async () => {
    const res = await request(app).get('/api/no-such-route');

    expect(res.status).toBe(404);
    expect(typeof res.body.message).toBe('string');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/status');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
