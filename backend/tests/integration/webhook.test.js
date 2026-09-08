/**
 * The webhook's correctness properties, against real Postgres.
 *
 * These are the claims the whole data-layer rewrite exists to make good on:
 * an event is processed exactly once however many times it is delivered, and
 * stock cannot go negative however many buyers race for the last unit. They are
 * asserted here rather than argued for.
 *
 * Signatures are verified for real — only Stripe's network calls are stubbed.
 */

const orderRepo = require('../../src/repositories/orderRepo');
const {
  query,
  resetDatabase,
  seedCatalog,
  seedUser,
  stockOf,
  lineItem,
  checkoutCompletedEvent,
  deliverEvent,
  stubLineItems,
  stubLineItemsWithBarrier,
} = require('./helpers');

let variants;

beforeEach(async () => {
  await resetDatabase();
  ({ variants } = await seedCatalog());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ordersFor = (sessionId) =>
  query('SELECT * FROM "Order" WHERE "stripeSessionId" = $1', [sessionId]);

describe('signature verification', () => {
  it('rejects a payload signed with the wrong secret', async () => {
    stubLineItems([]);
    const event = checkoutCompletedEvent({ id: 'evt_wrong', sessionId: 'cs_wrong' });

    const res = await deliverEvent(event, { secret: 'whsec_not_the_real_secret' });

    expect(res.status).toBe(400);
    expect(await ordersFor('cs_wrong')).toHaveLength(0);
  });

  it('rejects a missing signature header', async () => {
    const { request, app } = require('./helpers');
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('content-type', 'application/json')
      .send(JSON.stringify(checkoutCompletedEvent({ id: 'e', sessionId: 'cs_x' })));

    expect(res.status).toBe(400);
  });
});

describe('idempotency under replay', () => {
  it('processes one event exactly once across three deliveries', async () => {
    stubLineItems([lineItem(variants.M.id, 2)]);
    const event = checkoutCompletedEvent({ id: 'evt_replay', sessionId: 'cs_replay' });

    const first = await deliverEvent(event);
    const second = await deliverEvent(event);
    const third = await deliverEvent(event);

    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
    expect(first.body.outcome).toBe('created');
    expect(second.body.outcome).toBe('duplicate');
    expect(third.body.outcome).toBe('duplicate');

    expect(await ordersFor('cs_replay')).toHaveLength(1);
    expect(await query('SELECT * FROM "OrderItem"')).toHaveLength(1);
    expect(await stockOf(variants.M.id)).toBe(8); // 10 - 2, once
  });

  it('processes one event exactly once across two concurrent deliveries', async () => {
    // Both deliveries are held until both have arrived, so both transactions
    // are genuinely open at once. Without the barrier the first finishes before
    // the second starts and this passes against no concurrency control at all.
    stubLineItemsWithBarrier([lineItem(variants.M.id, 3)], 2);
    const event = checkoutCompletedEvent({ id: 'evt_conc', sessionId: 'cs_conc' });

    const [a, b] = await Promise.all([deliverEvent(event), deliverEvent(event)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.outcome, b.body.outcome].sort()).toEqual(['created', 'duplicate']);

    expect(await ordersFor('cs_conc')).toHaveLength(1);
    expect(await query('SELECT * FROM "OrderItem"')).toHaveLength(1);
    expect(await stockOf(variants.M.id)).toBe(7);
  });
});

describe('overselling', () => {
  it('refuses to sell more than the stock and commits nothing', async () => {
    stubLineItems([lineItem(variants.L.id, 2)]); // L has stock 1
    const event = checkoutCompletedEvent({ id: 'evt_over', sessionId: 'cs_over' });

    const res = await deliverEvent(event);

    // 200, not 500: the shortage is deterministic, so redelivery cannot help.
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('oversell');

    expect(await ordersFor('cs_over')).toHaveLength(0);
    expect(await query('SELECT * FROM "OrderItem"')).toHaveLength(0);
    expect(await stockOf(variants.L.id)).toBe(1);

    // The event claim rolls back with everything else, so a delivery that
    // failed for a transient reason is still retryable.
    expect(await query('SELECT * FROM "StripeEvent"')).toHaveLength(0);
  });

  it('lets exactly one of two concurrent buyers take the last unit', async () => {
    stubLineItemsWithBarrier([lineItem(variants.L.id, 1)], 2); // L has stock 1

    const [a, b] = await Promise.all([
      deliverEvent(
        checkoutCompletedEvent({ id: 'evt_race_a', sessionId: 'cs_race_a' }),
      ),
      deliverEvent(
        checkoutCompletedEvent({ id: 'evt_race_b', sessionId: 'cs_race_b' }),
      ),
    ]);

    // Two distinct events, so this is the stock decrement racing — not the
    // event-id idempotency.
    const outcomes = [a.body.outcome, b.body.outcome].sort();
    expect(outcomes).toEqual(['created', 'oversell']);
    expect([a.status, b.status]).toEqual([200, 200]);

    expect(await query('SELECT * FROM "Order"')).toHaveLength(1);
    expect(await stockOf(variants.L.id)).toBe(0);
  });

  it('never lets stock go negative', async () => {
    stubLineItemsWithBarrier([lineItem(variants.L.id, 1)], 5);

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        deliverEvent(
          checkoutCompletedEvent({ id: `evt_swarm_${i}`, sessionId: `cs_swarm_${i}` }),
        ),
      ),
    );

    expect(await stockOf(variants.L.id)).toBe(0);
    expect(
      await query('SELECT * FROM "ProductVariant" WHERE "stock" < 0'),
    ).toHaveLength(0);
    expect(await query('SELECT * FROM "Order"')).toHaveLength(1);
  });

  it('rolls back an earlier line when a later one oversells', async () => {
    stubLineItems([
      lineItem(variants.M.id, 2), // fine on its own
      lineItem(variants.L.id, 5), // L has stock 1
    ]);

    const res = await deliverEvent(
      checkoutCompletedEvent({ id: 'evt_partial', sessionId: 'cs_partial' }),
    );

    expect(res.body.outcome).toBe('oversell');
    expect(await ordersFor('cs_partial')).toHaveLength(0);

    // The whole point of the transaction: the first line's decrement is undone.
    expect(await stockOf(variants.M.id)).toBe(10);
    expect(await stockOf(variants.L.id)).toBe(1);
  });
});

describe('partial failure mid-transaction', () => {
  it('commits nothing when a write fails, and a retry then succeeds', async () => {
    stubLineItems([lineItem(variants.S.id, 1), lineItem(variants.M.id, 1)]);

    // Blow up on the second item, after the order and the first item are
    // already written inside the transaction.
    const insertItem = orderRepo.insertItem;
    let calls = 0;
    vi.spyOn(orderRepo, 'insertItem').mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated failure mid-transaction');
      return insertItem(...args);
    });

    const event = checkoutCompletedEvent({ id: 'evt_crash', sessionId: 'cs_crash' });
    const failed = await deliverEvent(event);

    // Not an oversell — a genuinely retryable failure, so Stripe should retry.
    expect(failed.status).toBe(500);

    expect(await ordersFor('cs_crash')).toHaveLength(0);
    expect(await query('SELECT * FROM "OrderItem"')).toHaveLength(0);
    expect(await stockOf(variants.S.id)).toBe(5);
    expect(await stockOf(variants.M.id)).toBe(10);
    expect(await query('SELECT * FROM "StripeEvent"')).toHaveLength(0);

    // Stripe redelivers; this time nothing is broken.
    vi.restoreAllMocks();
    stubLineItems([lineItem(variants.S.id, 1), lineItem(variants.M.id, 1)]);

    const retried = await deliverEvent(event);

    expect(retried.status).toBe(200);
    expect(retried.body.outcome).toBe('created');
    expect(await ordersFor('cs_crash')).toHaveLength(1);
    expect(await query('SELECT * FROM "OrderItem"')).toHaveLength(2);
    expect(await stockOf(variants.S.id)).toBe(4);
    expect(await stockOf(variants.M.id)).toBe(9);
  });
});

describe('event ordering and unhandled types', () => {
  it('acknowledges an unrelated event without recording it', async () => {
    const res = await deliverEvent({
      id: 'evt_pi',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    });

    expect(res.status).toBe(200);
    expect(await query('SELECT * FROM "StripeEvent"')).toHaveLength(0);
  });

  it('handles payment_intent.succeeded arriving before the checkout event', async () => {
    stubLineItems([lineItem(variants.M.id, 1)]);

    const early = await deliverEvent({
      id: 'evt_pi_early',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_early' } },
    });
    expect(early.status).toBe(200);

    const completed = await deliverEvent(
      checkoutCompletedEvent({ id: 'evt_ooo', sessionId: 'cs_ooo' }),
    );

    // The out-of-order delivery neither blocked nor duplicated the real one.
    expect(completed.body.outcome).toBe('created');
    expect(await ordersFor('cs_ooo')).toHaveLength(1);
    expect(await stockOf(variants.M.id)).toBe(9);
  });
});

describe('order contents', () => {
  it('records a session with no customer email instead of failing forever', async () => {
    stubLineItems([lineItem(variants.M.id, 1)]);

    const res = await deliverEvent(
      checkoutCompletedEvent({
        id: 'evt_noemail',
        sessionId: 'cs_noemail',
        email: null,
      }),
    );

    // Before migration 0005 this was a NOT NULL violation -> 500 -> Stripe
    // retrying the same doomed event indefinitely.
    expect(res.status).toBe(200);
    const [order] = await ordersFor('cs_noemail');
    expect(order.customerEmail).toBeNull();
    expect(order.userId).toBeNull();
  });

  it('stores shippingAddress as a real jsonb object', async () => {
    stubLineItems([lineItem(variants.M.id, 1)]);

    await deliverEvent(
      checkoutCompletedEvent({ id: 'evt_addr', sessionId: 'cs_addr' }),
    );

    const [order] = await ordersFor('cs_addr');

    // The Supabase client JSON.stringify'd this into a jsonb column, storing a
    // JSON string scalar — so `order.shippingAddress.city` was undefined.
    expect(order.shippingAddress).toMatchObject({ city: 'Boston', line1: '1 Main St' });
  });

  it('attaches the order to a registered customer by email', async () => {
    const user = await seedUser({ email: 'buyer@example.com' });
    stubLineItems([lineItem(variants.M.id, 1)]);

    await deliverEvent(
      checkoutCompletedEvent({ id: 'evt_known', sessionId: 'cs_known' }),
    );

    const [order] = await ordersFor('cs_known');
    expect(order.userId).toBe(user.id);
  });

  it('skips line items with no variantId without failing the order', async () => {
    stubLineItems([lineItem(variants.M.id, 1), lineItem(null, 1)]);

    const res = await deliverEvent(
      checkoutCompletedEvent({ id: 'evt_synth', sessionId: 'cs_synth' }),
    );

    expect(res.body.outcome).toBe('created');
    expect(await query('SELECT * FROM "OrderItem"')).toHaveLength(1);
  });
});
