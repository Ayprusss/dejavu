const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const variantRepo = require('../repositories/variantRepo');
const orderRepo = require('../repositories/orderRepo');
const stripe = require('../stripe');
const env = require('../config/env');
const logger = require('../lib/logger');
const { parseCartItems } = require('../lib/cart');
const { toCents, isChargeable } = require('../lib/money');

const FRONTEND_URL = env.FRONTEND_URL;

const createCheckout = async (req, res) => {
  try {
    // parseCartItems now merges duplicate lines, so `variantMap` lookups and
    // the stock check below each see one entry per variant carrying the full
    // requested quantity.
    const parseResult = parseCartItems(req.body?.items);

    if (!parseResult.ok) {
      return res.status(400).json({ message: parseResult.message });
    }

    const parsedItems = parseResult.items;
    const variantIds = parsedItems.map((item) => item.variantId);

    const variants = await variantRepo.findManyByIdsWithProduct(pool, variantIds);
    const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
    const lineItems = [];

    for (const item of parsedItems) {
      const variant = variantMap.get(item.variantId);

      if (!variant) {
        return res.status(400).json({
          message: `Variant ${item.variantId} was not found`,
        });
      }

      // `stock` is NOT NULL as of migration 0003, so this is an unconditional
      // comparison. It used to be guarded by `typeof stock === 'number'`,
      // which meant a null stock skipped validation and sold without limit.
      //
      // This check is advisory: it fails fast for the customer, but the
      // authority is the conditional decrement in the webhook, since stock can
      // change between here and payment.
      if (item.quantity > variant.stock) {
        return res.status(400).json({
          message: `Only ${variant.stock} units left for variant ${item.variantId}`,
        });
      }

      const unitAmount = toCents(variant.Product?.price);

      if (!isChargeable(unitAmount)) {
        throw new Error(`Variant ${item.variantId} is missing a valid product price`);
      }

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${variant.Product.name} - ${variant.size}`,
            metadata: {
              variantId: item.variantId,
            },
          },
          unit_amount: unitAmount,
        },
        quantity: item.quantity,
      });
    }

    // An idempotency key stops a network retry — ours or the client's — from
    // creating a second session and a second charge for one intent.
    //
    // The client supplies it, because only the client knows whether this is a
    // retry of the previous attempt or a deliberate second purchase of the
    // same cart. Deriving it server-side from the cart contents cannot tell
    // those apart, and would quietly return the first session to a customer
    // genuinely buying the same item twice. Absent a key we generate one, which
    // makes the Stripe call well-formed without pretending to deduplicate.
    const idempotencyKey =
      typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.length > 0
        ? req.body.idempotencyKey
        : randomUUID();

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: lineItems,
        success_url: `${FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${FRONTEND_URL}/checkout/cancel`,
        shipping_address_collection: {
          allowed_countries: ['US', 'CA'],
        },
        // Carries the buyer through to the webhook, which otherwise has to
        // reverse-look-up an account by email address and cannot tell a
        // matching address from a proven one.
        ...(req.user?.id ? { client_reference_id: req.user.id } : {}),
        metadata: {
          source: 'dejavu-backend',
        },
      },
      { idempotencyKey },
    );

    logger.info(
      {
        event: 'checkout.session_created',
        stripeSessionId: session.id,
        userId: req.user?.id ?? null,
        lineItemCount: lineItems.length,
      },
      'Checkout session created',
    );

    return res.status(200).json({
      checkoutUrl: session.url,
    });
  } catch (error) {
    logger.error(
      { event: 'checkout.failed', err: error },
      'Error creating checkout session',
    );

    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * The fields anyone holding the session id may see.
 *
 * The full record carries the customer's email address and full shipping
 * address. Session ids are high-entropy, but that is obscurity, not
 * authorization — and this endpoint is unauthenticated, so an id that leaks
 * (a shared URL, a referrer header, a browser history) used to hand over a
 * stranger's PII. The buyer's own success page needs the total and the status;
 * it does not need to be the thing that discloses an address.
 */
const toPublicOrder = (order) => ({
  id: order.id,
  stripeSessionId: order.stripeSessionId,
  status: order.status,
  totalAmount: order.totalAmount,
  createdAt: order.createdAt,
  itemCount: order.OrderItem.reduce((total, item) => total + item.quantity, 0),
});

/** Everything except the owner's id, which is internal. */
const toOwnerOrder = (order) => {
  // eslint-disable-next-line no-unused-vars
  const { userId, ...rest } = order;
  return rest;
};

const getCheckoutSession = async (req, res) => {
  const { sessionId } = req.params;

  if (!sessionId || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ message: 'A valid Stripe session id is required' });
  }

  try {
    const order = await orderRepo.findByStripeSessionIdWithItems(pool, sessionId);

    if (!order) {
      // Webhook may not have processed the session yet
      return res.status(404).json({ message: 'Order not found yet' });
    }

    const isOwner = Boolean(req.user?.id) && req.user.id === order.userId;

    return res.status(200).json(isOwner ? toOwnerOrder(order) : toPublicOrder(order));
  } catch (error) {
    logger.error(
      { event: 'checkout.session_lookup_failed', err: error },
      'Error fetching checkout session',
    );
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  createCheckout,
  getCheckoutSession,
};
