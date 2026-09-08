const stripe = require('../stripe');
const pool = require('../db/pool');
const withTransaction = require('../db/withTransaction');
const orderRepo = require('../repositories/orderRepo');
const userRepo = require('../repositories/userRepo');
const variantRepo = require('../repositories/variantRepo');
const stripeEventRepo = require('../repositories/stripeEventRepo');
const logger = require('../lib/logger');
const env = require('../config/env');

const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;

/**
 * A shortage found while committing an order.
 *
 * Distinguished from every other failure because it is *deterministic*: the
 * stock is not coming back, so replaying the event produces the same result.
 * Answering 500 would put Stripe into a retry loop against a fact.
 */
class OversellError extends Error {
  constructor(variantId, quantity) {
    super(`Insufficient stock for variant ${variantId} (wanted ${quantity})`);
    this.name = 'OversellError';
    this.variantId = variantId;
    this.quantity = quantity;
  }
}

const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    logger.warn(
      { event: 'webhook.signature_invalid', err: err.message },
      'Webhook signature verification failed',
    );
    return res.status(400).json({ message: `Webhook Error: ${err.message}` });
  }

  // Anything we do not act on is still a delivery we accepted. Answering
  // anything but 200 asks Stripe to redeliver an event we will ignore again.
  if (event.type !== 'checkout.session.completed') {
    logger.debug(
      {
        event: 'webhook.ignored',
        stripeEventType: event.type,
        stripeEventId: event.id,
      },
      'Unhandled event type acknowledged',
    );
    return res.status(200).json({ received: true });
  }

  try {
    const outcome = await handleCheckoutCompleted(event);
    return res.status(200).json({ received: true, outcome });
  } catch (err) {
    if (err instanceof OversellError) {
      // Committed nothing. The customer has been charged and we cannot fulfil,
      // which needs a human and a refund — but it does not need Stripe to keep
      // knocking, so this is a 200 with a loud, matchable log line. Phase 7's
      // alarm is a metric filter on this event name.
      logger.error(
        {
          event: 'checkout.oversell',
          stripeEventId: event.id,
          stripeSessionId: event.data.object?.id,
          variantId: err.variantId,
          quantity: err.quantity,
        },
        'Order rolled back: insufficient stock. Manual refund required.',
      );
      return res.status(200).json({ received: true, outcome: 'oversell' });
    }

    // Everything else — a dropped connection, a Stripe API blip — is worth
    // retrying, and 500 is how we ask for that.
    logger.error(
      { event: 'webhook.failed', stripeEventId: event.id, err },
      'Error processing checkout.session.completed',
    );
    return res.status(500).json({ message: 'Webhook handler failed' });
  }
};

/**
 * Record one completed checkout: the event, the order, its items and the stock
 * it consumed, all or nothing.
 *
 * The Stripe API calls happen before the transaction opens. Holding a pooled
 * connection open across network I/O is how a small pool turns into an outage
 * under load, and neither call needs to be inside the atomic region.
 */
async function handleCheckoutCompleted(event) {
  const session = event.data.object;

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    expand: ['data.price.product'],
  });

  const customerEmail = session.customer_details?.email ?? null;

  return withTransaction(pool, async (tx) => {
    // Claim the event first, inside the transaction. If this returns null the
    // event is already recorded and we stop without touching anything else;
    // if the transaction later rolls back, the claim rolls back with it and
    // the event stays retryable.
    const claimed = await stripeEventRepo.recordOnce(tx, {
      id: event.id,
      type: event.type,
    });

    if (!claimed) {
      logger.info(
        { event: 'webhook.duplicate', stripeEventId: event.id },
        'Event already processed, skipping',
      );
      return 'duplicate';
    }

    // A guest checkout has no account to attach to, and an email that matches
    // an account is not proof the buyer owns it — so this only links when the
    // address is already registered, and the success page's explicit claim is
    // what covers everyone else.
    let userId = null;
    if (customerEmail) {
      const user = await userRepo.findByEmail(tx, customerEmail);
      userId = user?.id ?? null;
    }

    const order = await orderRepo.insert(tx, {
      stripeSessionId: session.id,
      userId,
      customerEmail,
      totalAmount: (session.amount_total || 0) / 100,
      status: 'PAID',
      shippingAddress: session.shipping_details?.address ?? null,
    });

    for (const item of lineItems.data) {
      const variantId = item.price?.product?.metadata?.variantId;
      const quantity = item.quantity || 1;
      const priceAtSale = (item.amount_total || 0) / 100 / quantity;

      // Synthetic events from `stripe trigger` carry no variantId. Skipping
      // them keeps local testing usable; a real session always has one.
      if (!variantId) {
        logger.warn(
          { event: 'webhook.line_item_skipped', stripeEventId: event.id },
          'Line item has no variantId metadata (likely a test event)',
        );
        continue;
      }

      // No try/catch: a failure here has to take the whole order down with it.
      // Logging and continuing used to leave a PAID order missing items, and
      // then answer 200 so nothing ever revisited it.
      await orderRepo.insertItem(tx, {
        orderId: order.id,
        variantId,
        quantity,
        priceAtSale,
      });

      const variant = await variantRepo.decrementStock(tx, variantId, quantity);

      if (!variant) {
        throw new OversellError(variantId, quantity);
      }

      logger.debug(
        { event: 'stock.decremented', variantId, quantity, remaining: variant.stock },
        'Stock decremented',
      );
    }

    logger.info(
      {
        event: 'order.created',
        orderId: order.id,
        stripeSessionId: session.id,
        stripeEventId: event.id,
        totalAmount: order.totalAmount,
      },
      'Order committed',
    );

    return 'created';
  });
}

module.exports = {
  handleStripeWebhook,
  OversellError,
};
