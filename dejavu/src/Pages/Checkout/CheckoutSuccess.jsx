import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import './Checkout.css';

function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  return (
    <div className="checkout-page">
      <div className="checkout-icon checkout-icon--success">
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h1 className="checkout-title">Order Confirmed</h1>
      <p className="checkout-message">
        Thank you for your purchase. You will receive a confirmation email shortly
        with your order details and tracking information.
      </p>

      <div className="checkout-actions">
        <Link to="/pages/shop" className="checkout-btn">Continue Shopping</Link>
      </div>

      {sessionId && (
        <p className="checkout-order-id">Reference: {sessionId.substring(0, 20)}…</p>
      )}
    </div>
  );
}

export default CheckoutSuccess;
