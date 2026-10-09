import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { API_URL } from '../../config/api';
import OrderReceipt from '../../Components/OrderReceipt/OrderReceipt';
import { formatOrderNumber } from '../../lib/orders';
import { readSession } from '../../lib/session';
import './Checkout.css';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [order, setOrder] = useState(null);
  const [isLookingUp, setIsLookingUp] = useState(Boolean(sessionId));
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!sessionId) return undefined;

    let cancelled = false;
    let timeoutId = null;

    const fetchOrder = async () => {
      attemptRef.current += 1;

      try {
        // The line items and shipping address are only returned to the
        // order's owner, so a signed-in buyer has to identify themselves.
        const token = readSession()?.token;
        const response = await fetch(`${API_URL}/api/checkout/session/${sessionId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (response.ok) {
          const data = await response.json();
          if (!cancelled) {
            setOrder(data);
            setIsLookingUp(false);
          }
          return;
        }

        // 404 means the webhook has not created the order yet — retry briefly
        if (response.status === 404 && attemptRef.current < MAX_ATTEMPTS) {
          timeoutId = setTimeout(fetchOrder, RETRY_DELAY_MS);
          return;
        }

        if (!cancelled) setIsLookingUp(false);
      } catch {
        if (cancelled) return;
        if (attemptRef.current < MAX_ATTEMPTS) {
          timeoutId = setTimeout(fetchOrder, RETRY_DELAY_MS);
        } else {
          setIsLookingUp(false);
        }
      }
    };

    fetchOrder();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [sessionId]);

  return (
    <div className="checkout-page">
      <div className="checkout-inner">
        <h1 className="checkout-title">Order Confirmed</h1>

        <p className="checkout-message">
          Thank you for your purchase. A confirmation email with your order details and
          tracking information is on its way
          {order?.customerEmail ? ` to ${order.customerEmail}` : ''}.
        </p>

        {isLookingUp ? <p className="checkout-lookup">Retrieving your order…</p> : null}

        {order ? (
          <div className="checkout-order">
            <div className="checkout-order-row checkout-order-row--head">
              <span>Order</span>
              <span>{formatOrderNumber(order.id)}</span>
            </div>

            <OrderReceipt order={order} />
          </div>
        ) : null}

        <div className="checkout-actions">
          <Link to="/pages/shop" className="checkout-btn">
            Continue Shopping
          </Link>
          <Link to="/account/orders" className="checkout-link">
            View order history
          </Link>
        </div>

        {!order && sessionId ? (
          <p className="checkout-order-id">Reference: {sessionId.substring(0, 24)}…</p>
        ) : null}
      </div>
    </div>
  );
}

export default CheckoutSuccess;
