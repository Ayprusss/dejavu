/**
 * Idempotency key bookkeeping for a checkout attempt — pure functions, no
 * React, so the reuse/rotation rules can be tested without mounting <Cart>.
 *
 * The key is generated here, client-side, on purpose: the backend accepts an
 * optional `idempotencyKey` and only generates its own when one is missing
 * (see `backend/src/controllers/checkoutController.js`). Deriving one
 * server-side from the cart contents can't tell a double-submit apart from a
 * customer deliberately buying the same items twice — it would quietly hand
 * the second buyer the first buyer's session. Only the client knows which of
 * those this is, so the client owns the key: one per checkout *attempt*,
 * reused across a retry of that same attempt, replaced once the attempt ends
 * (cart changes, or the attempt succeeds and redirects to Stripe).
 */

/** Order-independent fingerprint of a cart's contents. */
export function cartAttemptSignature(items) {
  return items
    .map((item) => `${item.variantId}:${item.quantity}`)
    .sort()
    .join('|');
}

/**
 * Return the attempt to use for this checkout call.
 *
 * `prevAttempt` is whatever this function returned last time (or `null` for
 * a first attempt / after the previous one finished). When the cart's
 * signature matches, this is a retry of the same attempt, so the same key is
 * reused; otherwise a new attempt — and a new key — starts.
 */
export function getCheckoutAttempt(prevAttempt, items, generateKey = () => crypto.randomUUID()) {
  const signature = cartAttemptSignature(items);

  if (prevAttempt && prevAttempt.signature === signature) {
    return prevAttempt;
  }

  return { key: generateKey(), signature };
}
