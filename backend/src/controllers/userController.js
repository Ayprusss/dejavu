const pool = require('../db/pool');
const orderRepo = require('../repositories/orderRepo');

const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const orders = await orderRepo.findByUserIdWithItems(pool, userId);

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getUserOrders,
};
