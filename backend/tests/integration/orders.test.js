/**
 * Order ownership: who may claim an order, and who may read one.
 *
 * The vulnerability these replace was the most serious in the codebase —
 * registering with someone's email address inherited their order history and
 * shipping addresses.
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

const SESSION = 'cs_test_guest_order';

let guestOrder;

beforeEach(async () => {
  await resetDatabase();
  const { variants } = await seedCatalog();

  [guestOrder] = await query(
    `INSERT INTO "Order"
       ("customerEmail","totalAmount","status","stripeSessionId","shippingAddress")
     VALUES ('victim@example.com', 1260, 'PAID', $1,
             '{"city":"Boston","line1":"1 Main St","postal_code":"02101"}')
     RETURNING *`,
    [SESSION],
  );

  await query(
    `INSERT INTO "OrderItem" ("orderId","variantId","quantity","priceAtSale")
     VALUES ($1, $2, 2, 630)`,
    [guestOrder.id, variants.M.id],
  );
});

const registerAs = (email) =>
  request(app)
    .post('/api/auth/register')
    .send({ email, password: PASSWORD, firstName: 'A', lastName: 'B' });

describe('registration does not claim orders by email', () => {
  it('leaves a guest order unowned when someone registers with its address', async () => {
    const res = await registerAs('victim@example.com');
    expect(res.status).toBe(201);

    const orders = await request(app)
      .get('/api/user/orders')
      .set('Authorization', `Bearer ${res.body.token}`);

    expect(orders.body).toEqual([]);

    const [row] = await query('SELECT "userId" FROM "Order" WHERE "id" = $1', [
      guestOrder.id,
    ]);
    expect(row.userId).toBeNull();
  });
});

describe('POST /api/user/orders/claim', () => {
  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/user/orders/claim')
      .send({ stripeSessionId: SESSION });

    expect(res.status).toBe(401);
  });

  it('rejects a malformed session id', async () => {
    await seedUser({ email: 'buyer@example.com' });
    const token = await loginAs('buyer@example.com');

    const res = await request(app)
      .post('/api/user/orders/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ stripeSessionId: 'not-a-stripe-session' });

    expect(res.status).toBe(400);
  });

  it('attaches the order to the caller when the session id is right', async () => {
    await seedUser({ email: 'buyer@example.com' });
    const token = await loginAs('buyer@example.com');

    const claim = await request(app)
      .post('/api/user/orders/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ stripeSessionId: SESSION });

    expect(claim.status).toBe(200);

    const orders = await request(app)
      .get('/api/user/orders')
      .set('Authorization', `Bearer ${token}`);

    expect(orders.body).toHaveLength(1);
    expect(orders.body[0].id).toBe(guestOrder.id);
  });

  it('cannot take an order that already belongs to someone', async () => {
    await seedUser({ email: 'buyer@example.com' });
    await seedUser({ email: 'attacker@example.com' });

    const buyerToken = await loginAs('buyer@example.com');
    const attackerToken = await loginAs('attacker@example.com');

    await request(app)
      .post('/api/user/orders/claim')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ stripeSessionId: SESSION });

    const stolen = await request(app)
      .post('/api/user/orders/claim')
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ stripeSessionId: SESSION });

    expect(stolen.status).toBe(404);

    const attackerOrders = await request(app)
      .get('/api/user/orders')
      .set('Authorization', `Bearer ${attackerToken}`);
    expect(attackerOrders.body).toEqual([]);
  });

  it('answers an unknown session id exactly as it answers a taken one', async () => {
    await seedUser({ email: 'buyer@example.com' });
    await seedUser({ email: 'attacker@example.com' });
    const buyerToken = await loginAs('buyer@example.com');
    const attackerToken = await loginAs('attacker@example.com');

    await request(app)
      .post('/api/user/orders/claim')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ stripeSessionId: SESSION });

    const taken = await request(app)
      .post('/api/user/orders/claim')
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ stripeSessionId: SESSION });

    const unknown = await request(app)
      .post('/api/user/orders/claim')
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ stripeSessionId: 'cs_no_such_session_at_all' });

    // Identical responses, or the endpoint tells an attacker which session ids
    // are real.
    expect(taken.status).toBe(unknown.status);
    expect(taken.body).toEqual(unknown.body);
  });
});

describe('GET /api/checkout/session/:sessionId', () => {
  it('gives an anonymous caller no personal data', async () => {
    const res = await request(app).get(`/api/checkout/session/${SESSION}`);

    expect(res.status).toBe(200);
    expect(res.body.customerEmail).toBeUndefined();
    expect(res.body.shippingAddress).toBeUndefined();
    expect(res.body.OrderItem).toBeUndefined();
    expect(res.body.userId).toBeUndefined();

    // Enough for the buyer's success page to confirm the purchase.
    expect(res.body.totalAmount).toBe(1260);
    expect(res.body.status).toBe('PAID');
    expect(res.body.itemCount).toBe(2);
  });

  it('gives a signed-in non-owner no more than an anonymous caller', async () => {
    await seedUser({ email: 'nosy@example.com' });
    const token = await loginAs('nosy@example.com');

    const anon = await request(app).get(`/api/checkout/session/${SESSION}`);
    const nonOwner = await request(app)
      .get(`/api/checkout/session/${SESSION}`)
      .set('Authorization', `Bearer ${token}`);

    expect(nonOwner.body).toEqual(anon.body);
  });

  it('gives the owner the full order', async () => {
    await seedUser({ email: 'buyer@example.com' });
    const token = await loginAs('buyer@example.com');

    await request(app)
      .post('/api/user/orders/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ stripeSessionId: SESSION });

    const res = await request(app)
      .get(`/api/checkout/session/${SESSION}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.customerEmail).toBe('victim@example.com');
    expect(res.body.shippingAddress).toMatchObject({ city: 'Boston' });
    expect(res.body.OrderItem).toHaveLength(1);
    // Internal, and not disclosed even to the owner.
    expect(res.body.userId).toBeUndefined();
  });

  it('404s before the webhook has recorded the order', async () => {
    const res = await request(app).get('/api/checkout/session/cs_not_yet_processed');
    expect(res.status).toBe(404);
  });

  it('400s on something that is not a session id', async () => {
    const res = await request(app).get('/api/checkout/session/12345');
    expect(res.status).toBe(400);
  });

  it('ignores an expired or malformed token rather than rejecting the request', async () => {
    // A guest checking out with a stale token in localStorage must still be
    // able to see their own confirmation.
    const res = await request(app)
      .get(`/api/checkout/session/${SESSION}`)
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(200);
  });
});
