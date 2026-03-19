const express = require('express');
const router = express.Router();
const { handleStripeWebhook } = require('../controllers/webhookController');

router.post('/', handleStripeWebhook);

module.exports = router;
