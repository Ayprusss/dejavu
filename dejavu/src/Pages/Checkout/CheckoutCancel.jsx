import { Link } from 'react-router-dom';
import './Checkout.css';

function CheckoutCancel() {
  return (
    <div className="checkout-page">
      <div className="checkout-icon checkout-icon--cancel">
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>

      <h1 className="checkout-title">Checkout Cancelled</h1>
      <p className="checkout-message">
        Your order was not completed. No charges have been made.
        Your cart items are still saved if you&apos;d like to try again.
      </p>

      <div className="checkout-actions">
        <Link to="/pages/shop" className="checkout-btn">Return to Shop</Link>
      </div>
    </div>
  );
}

export default CheckoutCancel;
