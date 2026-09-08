/**
 * Cart parsing and validation for incoming checkout requests.
 *
 * Pure: no database, no Stripe, no environment. Kept out of the controller so
 * the rules can be tested directly and so they survive the data-layer rewrite.
 */

const EMPTY_CART_MESSAGE = 'Cart is empty';
const INVALID_ITEM_MESSAGE =
  'Each cart item must include a variantId and a positive integer quantity';

/**
 * Narrow and validate a client-supplied cart.
 *
 * Only `variantId` and `quantity` survive: any other field the client sends —
 * `price` above all — is dropped here rather than trusted downstream. Pricing
 * is always looked up server-side.
 *
 * @returns {{ok: true, items: Array<{variantId: string, quantity: number}>}
 *          |{ok: false, message: string}}
 */
const parseCartItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, message: EMPTY_CART_MESSAGE };
  }

  const parsed = items.map((item) => ({
    variantId: item?.variantId,
    quantity: Number(item?.quantity),
  }));

  const hasInvalidItem = parsed.some(
    (item) => !item.variantId || !Number.isInteger(item.quantity) || item.quantity <= 0,
  );

  if (hasInvalidItem) {
    return { ok: false, message: INVALID_ITEM_MESSAGE };
  }

  // Aggregate duplicate lines before anything downstream sees them.
  //
  // Stock is validated per line, so `[{v,3},{v,3}]` against a stock of 5 used
  // to pass twice and sell 6. Merging here means the check runs once against
  // the real total. Insertion order is preserved so the Stripe line items stay
  // in the order the customer built the cart.
  const merged = new Map();

  for (const item of parsed) {
    const existing = merged.get(item.variantId);

    if (existing) {
      existing.quantity += item.quantity;
    } else {
      merged.set(item.variantId, { ...item });
    }
  }

  return { ok: true, items: [...merged.values()] };
};

module.exports = { parseCartItems, EMPTY_CART_MESSAGE, INVALID_ITEM_MESSAGE };
