const stripe = require('../stripe');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const orderRepo = require('../repositories/orderRepo');
const userRepo = require('../repositories/userRepo');
const variantRepo = require('../repositories/variantRepo');
const env = require('../config/env');

const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;

const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ message: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      await handleCheckoutCompleted(session);
    } catch (err) {
      console.error('Error processing checkout.session.completed:', err);
      return res.status(500).json({ message: 'Webhook handler failed' });
    }
  }

  // Acknowledge receipt of the event
  return res.status(200).json({ received: true });
};

/**
 * PHASE 3 REWRITES THIS FUNCTION. It is ported statement-for-statement onto the
 * repositories and left otherwise alone, so the correctness work lands as a
 * reviewable diff with tests behind it rather than hiding inside the data-layer
 * swap. The known defects, all still present:
 *
 *   - No transaction. A crash midway leaves a PAID order with partial items and
 *     partially-decremented stock, and because the order row exists the
 *     idempotency probe below makes every retry skip — cementing it.
 *   - The idempotency probe is a read-then-write that two concurrent deliveries
 *     both pass. Migration 0004 added the StripeEvent table it should use.
 *   - Stock decrement is read-modify-write: a lost update. `Math.max(..., 0)`
 *     hides an oversell instead of preventing it.
 *   - OrderItem insert failures are logged and swallowed, then answered 200.
 *
 * One defect is already gone, as a side effect of the driver change rather than
 * a decision: `shippingAddress` used to be JSON.stringify'd into a jsonb column
 * by the Supabase client, storing a JSON string scalar, so
 * `order.shippingAddress.city` read `undefined`. node-postgres serialises the
 * object itself, so the column now holds a real object.
 */
async function handleCheckoutCompleted(session) {
  // --- Idempotency check: skip if we already processed this session ---
  const existingOrder = await orderRepo.findIdByStripeSessionId(pool, session.id);

  if (existingOrder) {
    console.log(`Order for session ${session.id} already exists, skipping.`);
    return;
  }

  // --- Retrieve line items with product metadata (contains variantId) ---
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    expand: ['data.price.product'],
  });

  // --- Look up user by email (nullable for guest checkouts) ---
  let userId = null;
  const customerEmail = session.customer_details?.email;

  if (customerEmail) {
    const user = await userRepo.findByEmail(pool, customerEmail);

    if (user) {
      userId = user.id;
    }
  }

  // --- Create the Order row ---
  const orderId = randomUUID();

  await orderRepo.insert(pool, {
    id: orderId,
    stripeSessionId: session.id,
    userId,
    customerEmail: customerEmail || null,
    totalAmount: (session.amount_total || 0) / 100,
    status: 'PAID',
    shippingAddress: session.shipping_details?.address ?? null,
  });

  console.log(`Created Order ${orderId} for session ${session.id}`);

  // --- Create OrderItem rows and decrement stock ---
  for (const item of lineItems.data) {
    const variantId = item.price?.product?.metadata?.variantId;
    const quantity = item.quantity || 1;
    const priceAtSale = (item.amount_total || 0) / 100 / quantity;

    // Skip items without a variantId (e.g. synthetic events from `stripe trigger`)
    if (!variantId) {
      console.warn(
        'Skipping line item with no variantId metadata (likely a test event)',
      );
      continue;
    }

    // Create the OrderItem
    try {
      await orderRepo.insertItem(pool, {
        id: randomUUID(),
        orderId,
        variantId,
        quantity,
        priceAtSale,
      });
    } catch (itemError) {
      console.error(
        `Failed to create OrderItem for variant ${variantId}:`,
        itemError.message,
      );
    }

    // Decrement stock for the variant
    try {
      const variant = await variantRepo.findById(pool, variantId);

      if (!variant) {
        console.error(`Failed to fetch stock for variant ${variantId}: not found`);
        continue;
      }

      const newStock = Math.max((variant.stock || 0) - quantity, 0);

      await variantRepo.updateStockById(pool, variantId, newStock);

      console.log(
        `Decremented stock for variant ${variantId}: ${variant.stock} → ${newStock}`,
      );
    } catch (stockError) {
      console.error(
        `Failed to update stock for variant ${variantId}:`,
        stockError.message,
      );
    }
  }
}

module.exports = {
  handleStripeWebhook,
};
