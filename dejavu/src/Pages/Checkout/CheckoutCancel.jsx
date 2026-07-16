import { Link } from 'react-router-dom';
import './Checkout.css';

function CheckoutCancel() {
  return (
    <div className="checkout-page">
      <div className="checkout-inner">
        <h1 className="checkout-title">Checkout Cancelled</h1>

        <p className="checkout-message">
          Your order was not completed and no charges have been made.
          Your cart has been saved if you would like to try again.
        </p>

        <div className="checkout-actions">
          <Link to="/pages/shop" className="checkout-btn">
            Return to Shop
          </Link>
          <Link to="/contact" className="checkout-link">
            Need help? Contact us
          </Link>
        </div>
      </div>
    </div>
  );
}

export default CheckoutCancel;
