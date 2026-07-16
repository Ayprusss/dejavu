const express = require('express');
const router = express.Router();
const { createCheckout, getCheckoutSession } = require('../controllers/checkoutController');

router.post('/', createCheckout);
router.get('/session/:sessionId', getCheckoutSession);

module.exports = router;    
