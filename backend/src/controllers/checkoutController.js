const pool = require('../db/pool');
const variantRepo = require('../repositories/variantRepo');
const orderRepo = require('../repositories/orderRepo');
const stripe = require('../stripe');
const env = require('../config/env');
const { parseCartItems } = require('../lib/cart');
const { toCents, isChargeable } = require('../lib/money');

const FRONTEND_URL = env.FRONTEND_URL;

const createCheckout = async (req, res) => {
  try {
    const parseResult = parseCartItems(req.body?.items);

    if (!parseResult.ok) {
      return res.status(400).json({ message: parseResult.message });
    }

    const parsedItems = parseResult.items;

    const variantIds = [...new Set(parsedItems.map((item) => item.variantId))];

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

      if (typeof variant.stock === 'number' && item.quantity > variant.stock) {
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

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: `${FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/checkout/cancel`,
      shipping_address_collection: {
        allowed_countries: ['US', 'CA'],
      },
      metadata: {
        source: 'dejavu-backend',
      },
    });

    return res.status(200).json({
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);

    return res.status(500).json({ message: 'Internal server error' });
  }
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

    return res.status(200).json(order);
  } catch (error) {
    console.error('Error fetching checkout session:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  createCheckout,
  getCheckoutSession,
};
