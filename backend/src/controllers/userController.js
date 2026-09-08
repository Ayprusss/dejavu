const pool = require('../db/pool');
const orderRepo = require('../repositories/orderRepo');
const logger = require('../lib/logger');

const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const orders = await orderRepo.findByUserIdWithItems(pool, userId);

    res.status(200).json(orders);
  } catch (error) {
    logger.error(
      { event: 'user.orders_failed', userId: req.user?.id, err: error },
      'Error fetching user orders',
    );
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Attach a guest order placed before registering to the calling account.
 *
 * The `stripeSessionId` is the proof of ownership: it is high-entropy and is
 * only ever shown to the person who completed the payment, on their own success
 * page. That is what registration-time email matching lacked — it claimed every
 * order sharing an address, so anyone who knew a buyer's email could register
 * with it and inherit that buyer's order history and shipping addresses.
 */
const claimOrder = async (req, res) => {
  const { stripeSessionId } = req.body ?? {};

  if (typeof stripeSessionId !== 'string' || !stripeSessionId.startsWith('cs_')) {
    return res.status(400).json({ message: 'A valid Stripe session id is required' });
  }

  try {
    const order = await orderRepo.claimBySessionId(pool, {
      stripeSessionId,
      userId: req.user.id,
    });

    if (!order) {
      // One response for "no such order" and for "already claimed". Telling
      // them apart would turn this endpoint into an oracle for which session
      // ids exist.
      logger.warn(
        { event: 'order.claim_rejected', userId: req.user.id, stripeSessionId },
        'Order claim rejected',
      );
      return res.status(404).json({ message: 'No claimable order for that session' });
    }

    logger.info(
      { event: 'order.claimed', userId: req.user.id, orderId: order.id },
      'Guest order claimed',
    );

    return res.status(200).json({ message: 'Order claimed', orderId: order.id });
  } catch (error) {
    logger.error(
      { event: 'order.claim_failed', userId: req.user?.id, err: error },
      'Error claiming order',
    );
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  getUserOrders,
  claimOrder,
};
