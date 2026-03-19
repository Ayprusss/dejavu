const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');

// Protect all admin routes with auth and admin checks
router.use(verifyToken, requireAdmin);

router.post('/products', adminController.createProduct);
router.put('/products/:id', adminController.updateProduct);
router.put('/inventory/:variantId', adminController.updateInventory);
router.get('/orders', adminController.getOrders);
router.put('/orders/:orderId/status', adminController.updateOrderStatus);

module.exports = router;
