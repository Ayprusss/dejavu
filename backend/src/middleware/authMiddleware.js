const jwt = require('jsonwebtoken');
const env = require('../config/env');

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Forbidden: Admin access required' });
  }
  next();
};

/**
 * Populate `req.user` when a valid token is present; never reject.
 *
 * For endpoints that serve both signed-in and anonymous callers and behave
 * differently for each — checkout attaches the buyer to the Stripe session,
 * and the success page decides how much of an order it is willing to show.
 *
 * A malformed or expired token is treated as no token at all. The alternative
 * is failing a guest checkout because of a stale token in localStorage, which
 * turns an expired session into a lost sale.
 */
const attachUserIfPresent = (req, _res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (token) {
    try {
      req.user = jwt.verify(token, env.JWT_SECRET);
    } catch {
      req.user = undefined;
    }
  }

  next();
};

module.exports = {
  verifyToken,
  requireAdmin,
  attachUserIfPresent,
};
