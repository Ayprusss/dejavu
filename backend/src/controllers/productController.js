const pool = require('../db/pool');
const productRepo = require('../repositories/productRepo');
const { validate: isUuid } = require('uuid');
const logger = require('../lib/logger');

const getProducts = async (req, res) => {
  try {
    const products = await productRepo.findAllWithVariants(pool);

    res.status(200).json(products);
  } catch (error) {
    logger.error(
      { event: 'product.list_failed', err: error },
      'Error fetching products',
    );

    res.status(500).json({ message: 'Internal server error' });
  }
};

const getProductById = async (req, res) => {
  const { id } = req.params;

  try {
    // The route accepts either a UUID or a Stripe product id. The branch is
    // load-bearing now in a way it was not before: passing a non-UUID to a
    // `uuid` column is a 22P02 error from Postgres, where PostgREST returned
    // an empty result.
    const product = isUuid(id)
      ? await productRepo.findByIdWithVariants(pool, id)
      : await productRepo.findByStripeProductIdWithVariants(pool, id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json(product);
  } catch (error) {
    logger.error(
      { event: 'product.fetch_failed', productId: id, err: error },
      'Error fetching product',
    );

    res.status(500).json({ message: 'Server error fetching product details' });
  }
};

module.exports = {
  getProducts,
  getProductById,
};
