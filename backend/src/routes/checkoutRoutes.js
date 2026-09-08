const express = require('express');
const router = express.Router();
const {
  createCheckout,
  getCheckoutSession,
} = require('../controllers/checkoutController');
const { attachUserIfPresent } = require('../middleware/authMiddleware');

// Both routes serve guests and signed-in customers, and behave differently for
// each: checkout stamps the buyer onto the Stripe session, and the session
// lookup shows the full order only to its owner. Neither may reject a guest.
router.post('/', attachUserIfPresent, createCheckout);
router.get('/session/:sessionId', attachUserIfPresent, getCheckoutSession);

module.exports = router;
