import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { API_URL } from '../../config/api';
import './Checkout.css';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`;
}

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
        const response = await fetch(`${API_URL}/api/checkout/session/${sessionId}`);

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

  let shipping = null;
  if (order?.shippingAddress) {
    try {
      shipping =
        typeof order.shippingAddress === 'string'
          ? JSON.parse(order.shippingAddress)
          : order.shippingAddress;
    } catch {
      shipping = null;
    }
  }

  const items = order?.OrderItem ?? [];

  return (
    <div className="checkout-page">
      <div className="checkout-inner">
        <h1 className="checkout-title">Order Confirmed</h1>

        <p className="checkout-message">
          Thank you for your purchase. A confirmation email with your order
          details and tracking information is on its way
          {order?.customerEmail ? ` to ${order.customerEmail}` : ''}.
        </p>

        {isLookingUp ? (
          <p className="checkout-lookup">Retrieving your order…</p>
        ) : null}

        {order ? (
          <div className="checkout-order">
            <div className="checkout-order-row checkout-order-row--head">
              <span>Order</span>
              <span>{order.id.substring(0, 8).toUpperCase()}</span>
            </div>

            {items.map((item) => {
              const product = item.ProductVariant?.Product;
              const image = product?.images?.[0];
              return (
                <div key={item.id} className="checkout-order-item">
                  {image ? (
                    <img
                      className="checkout-order-item-image"
                      src={image}
                      alt={product?.name ?? 'Ordered item'}
                    />
                  ) : null}
                  <div className="checkout-order-item-info">
                    <p className="checkout-order-item-name">
                      {product?.name ?? 'Item'}
                    </p>
                    <p className="checkout-order-item-meta">
                      {item.ProductVariant?.size ? `Size: ${item.ProductVariant.size}` : null}
                      {item.ProductVariant?.size ? ' · ' : ''}
                      Qty: {item.quantity}
                    </p>
                  </div>
                  <span className="checkout-order-item-price">
                    {formatMoney(item.priceAtSale)}
                  </span>
                </div>
              );
            })}

            <div className="checkout-order-row checkout-order-row--total">
              <span>Total</span>
              <span>{formatMoney(order.totalAmount)}</span>
            </div>

            {shipping ? (
              <div className="checkout-shipping">
                <p className="checkout-shipping-heading">Ships to</p>
                <p className="checkout-shipping-line">
                  {[
                    shipping.line1,
                    shipping.line2,
                    shipping.city,
                    shipping.state,
                    shipping.postal_code,
                    shipping.country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="checkout-actions">
          <Link to="/pages/shop" className="checkout-btn">
            Continue Shopping
          </Link>
          <Link to="/account" className="checkout-link">
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
