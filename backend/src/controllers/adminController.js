const pool = require('../db/pool');
const productRepo = require('../repositories/productRepo');
const variantRepo = require('../repositories/variantRepo');
const orderRepo = require('../repositories/orderRepo');
const logger = require('../lib/logger');

const createProduct = async (req, res) => {
  const { stripeProductId, name, description, price, images, sizeGuide } = req.body;

  if (!stripeProductId || !name || !description || !price || !images) {
    return res.status(400).json({ message: 'Required product fields are missing' });
  }

  try {
    const product = await productRepo.insert(pool, {
      stripeProductId,
      name,
      description,
      price,
      images,
      sizeGuide,
    });

    res.status(201).json({ message: 'Product created successfully', product });
  } catch (error) {
    logger.error(
      { event: 'admin.product_create_failed', err: error },
      'Error creating product',
    );
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateProduct = async (req, res) => {
  const { id } = req.params;

  // The repository narrows the body to its own column allowlist, so `id` and
  // anything else unrecognised is dropped rather than deleted by hand here.
  // `updatedAt` is the trigger's job as of migration 0006.
  const updates = productRepo.pickUpdatable(req.body);

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      message: `No updatable fields provided. Allowed: ${productRepo.UPDATABLE_COLUMNS.join(', ')}`,
    });
  }

  try {
    const product = await productRepo.updateById(pool, id, updates);

    if (!product) return res.status(404).json({ message: 'Product not found' });

    res.status(200).json({ message: 'Product updated successfully', product });
  } catch (error) {
    logger.error(
      { event: 'admin.product_update_failed', productId: id, err: error },
      'Error updating product',
    );
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateInventory = async (req, res) => {
  const { variantId } = req.params;
  const { stock } = req.body;

  if (stock === undefined) {
    return res.status(400).json({ message: 'Stock value is required' });
  }

  // Migration 0003 added CHECK (stock >= 0). Without this guard a negative
  // value reaches the database and comes back as a constraint violation, which
  // would surface to the admin as a 500 for what is plainly a bad request.
  if (!Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ message: 'Stock must be a non-negative integer' });
  }

  try {
    const variant = await variantRepo.updateStockById(pool, variantId, stock);

    if (!variant) return res.status(404).json({ message: 'Variant not found' });

    res.status(200).json({ message: 'Inventory updated successfully', variant });
  } catch (error) {
    logger.error(
      { event: 'admin.inventory_update_failed', variantId, err: error },
      'Error updating inventory',
    );
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getOrders = async (req, res) => {
  try {
    const orders = await orderRepo.findAllWithUserAndItems(pool);

    res.status(200).json(orders);
  } catch (error) {
    logger.error(
      { event: 'admin.orders_fetch_failed', err: error },
      'Error fetching orders',
    );
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  const validStatuses = ['PAID', 'SHIPPED', 'FULFILLED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    return res
      .status(400)
      .json({ message: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const order = await orderRepo.updateStatusById(pool, orderId, status);

    if (!order) return res.status(404).json({ message: 'Order not found' });

    res.status(200).json({ message: 'Order status updated', order });
  } catch (error) {
    logger.error(
      { event: 'admin.order_status_failed', orderId, err: error },
      'Error updating order status',
    );
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  createProduct,
  updateProduct,
  updateInventory,
  getOrders,
  updateOrderStatus,
};
