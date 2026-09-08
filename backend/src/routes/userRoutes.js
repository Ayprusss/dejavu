const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/orders', verifyToken, userController.getUserOrders);
router.post('/orders/claim', verifyToken, userController.claimOrder);

module.exports = router;
