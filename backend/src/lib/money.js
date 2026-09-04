/**
 * Money helpers.
 *
 * Prices are stored as decimal dollars but Stripe bills in integer cents, so
 * every conversion has to round rather than truncate: `0.1 * 100` is
 * 10.000000000000002 in IEEE-754, and `Math.trunc` on `19.99 * 100`
 * (1998.9999999999998) silently undercharges by a cent.
 */

/** Convert a decimal-dollar amount to integer cents. */
const toCents = (value) => Math.round(Number(value) * 100);

/** True when `cents` is a chargeable amount: a finite, positive integer. */
const isChargeable = (cents) => Number.isInteger(cents) && cents > 0;

module.exports = { toCents, isChargeable };
