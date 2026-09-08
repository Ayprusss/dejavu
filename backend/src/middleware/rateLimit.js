/**
 * Rate limits on the two endpoints where an unthrottled caller costs something.
 *
 * In-memory counters, which means per-instance: two instances give a caller
 * twice the budget, and a restart forgets everything. That is a real limitation
 * and the right trade-off at this size — the alternative is a Redis dependency
 * to make the numbers exact, and exactness is not what these are for. They
 * exist to make automated abuse expensive, not to meter legitimate use.
 */

const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');

const onLimit = (event) => (req, res, _next, options) => {
  logger.warn({ event, ip: req.ip, path: req.originalUrl }, 'Rate limit exceeded');
  res.status(options.statusCode).json({ message: options.message });
};

/**
 * Login. There is no lockout and no attempt counter on the account itself, so
 * without this a single client can try passwords as fast as bcrypt will answer.
 *
 * Counting only failures is what makes the budget small enough to matter: a
 * legitimate customer mistyping a password a few times is unaffected, while
 * someone working through a password list exhausts it immediately.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many login attempts. Try again later.',
  handler: onLimit('ratelimit.login'),
});

/**
 * Checkout. Unauthenticated, and every call creates a Stripe object — so it is
 * both a spend and a way to fill the Stripe dashboard with junk sessions.
 */
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many checkout attempts. Try again later.',
  handler: onLimit('ratelimit.checkout'),
});

module.exports = { loginLimiter, checkoutLimiter };
