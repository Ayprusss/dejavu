/**
 * Cart operations — pure functions over an items array.
 *
 * Extracted from App.jsx so the rules can be tested without mounting the app.
 * Every function returns a new array; none mutates its input.
 */

/**
 * Coerce a price into a number.
 *
 * Prefer passing a real number. The string branch exists only for legacy
 * callers that carry a formatted label like `"$1,980.00 USD"`; it strips
 * everything that is not a digit, dot, or minus sign. That is lossy — it turns
 * `"$1.980,00"` (European formatting) into `1.98` — which is exactly why the
 * numeric price is now carried alongside the label rather than parsed back out
 * of it.
 */
export function parsePrice(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Stable identity for a cart line: the variant if known, else product+size. */
export function cartLineId(payload) {
  return payload.variantId || `${payload.productId}-${payload.size}`;
}

export function cartItemCount(items) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function cartSubtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function incrementItem(items, itemId) {
  return items.map((item) =>
    item.id === itemId ? { ...item, quantity: item.quantity + 1 } : item,
  );
}

/** Decrement, dropping the line when it would reach zero. */
export function decrementItem(items, itemId) {
  return items
    .map((item) =>
      item.id === itemId ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item,
    )
    .filter((item) => item.quantity > 0);
}

export function removeItem(items, itemId) {
  return items.filter((item) => item.id !== itemId);
}

/**
 * Add a product to the cart, merging into an existing line for the same
 * variant. Returns the original array unchanged when the payload is unusable.
 */
export function addItem(items, payload, fallbackImage) {
  if (!payload || !payload.size) {
    return items;
  }

  const id = cartLineId(payload);
  const existing = items.find((item) => item.id === id);

  if (existing) {
    return incrementItem(items, id);
  }

  return [
    ...items,
    {
      id,
      variantId: payload.variantId,
      stripePriceId: payload.stripePriceId,
      name: payload.name,
      size: payload.size,
      // `price` is the numeric source of truth; `priceLabel` is display only.
      price: parsePrice(payload.price ?? payload.priceLabel),
      quantity: 1,
      image: payload.image || fallbackImage,
    },
  ];
}
