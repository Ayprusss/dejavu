import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../../config/api';
import './Cart.css';

function formatPrice(value) {
  return `$${value.toFixed(2)}`;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.5 3.5L12.5 12.5" />
      <path d="M12.5 3.5L3.5 12.5" />
    </svg>
  );
}

function Cart({
  isOpen = false,
  itemCount = 0,
  items = [],
  onOpen,
  onClose,
  onIncrement,
  onDecrement,
  onRemove,
}) {
  const ANIMATION_MS = 500;
  const hasItems = itemCount > 0;
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [exitingItemIds, setExitingItemIds] = useState([]);
  const [isSubtotalLoading, setIsSubtotalLoading] = useState(false);
  const removeTimeoutsRef = useRef({});
  const subtotalLoadingTimeoutRef = useRef(null);
  const previousItemCountRef = useRef(itemCount);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      setIsClosing(false);
      return undefined;
    }

    if (!isMounted) {
      return undefined;
    }

    setIsClosing(true);
    const timeoutId = setTimeout(() => {
      setIsMounted(false);
      setIsClosing(false);
    }, ANIMATION_MS);

    return () => clearTimeout(timeoutId);
  }, [isOpen, isMounted]);

  useEffect(() => {
    return () => {
      Object.values(removeTimeoutsRef.current).forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      if (subtotalLoadingTimeoutRef.current) {
        clearTimeout(subtotalLoadingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (itemCount !== previousItemCountRef.current) {
      setIsSubtotalLoading(true);
      if (subtotalLoadingTimeoutRef.current) {
        clearTimeout(subtotalLoadingTimeoutRef.current);
      }
      subtotalLoadingTimeoutRef.current = setTimeout(() => {
        setIsSubtotalLoading(false);
      }, 900);
    }

    previousItemCountRef.current = itemCount;
  }, [itemCount]);

  const startSubtotalLoading = () => {
    setIsSubtotalLoading(true);
    if (subtotalLoadingTimeoutRef.current) {
      clearTimeout(subtotalLoadingTimeoutRef.current);
    }
    subtotalLoadingTimeoutRef.current = setTimeout(() => {
      setIsSubtotalLoading(false);
    }, 900);
  };

  const animateAndRemove = (itemId) => {
    if (exitingItemIds.includes(itemId)) return;

    startSubtotalLoading();
    setExitingItemIds((prev) => [...prev, itemId]);

    removeTimeoutsRef.current[itemId] = setTimeout(() => {
      onRemove(itemId);
      setExitingItemIds((prev) => prev.filter((id) => id !== itemId));
      delete removeTimeoutsRef.current[itemId];
    }, ANIMATION_MS);
  };

  const handleDecrementClick = (item) => {
    startSubtotalLoading();

    if (item.quantity <= 1) {
      animateAndRemove(item.id);
      return;
    }

    onDecrement(item.id);
  };

  const handleIncrementClick = (itemId) => {
    startSubtotalLoading();
    onIncrement(itemId);
  };

  const isControlLocked = isSubtotalLoading;

  const isCheckoutDisabled = !hasItems || isSubtotalLoading;

  const handleCheckout = async () => {
    try {
      const response = await fetch(`${API_URL}/api/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Checkout error:', data.message);
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (error) {
      console.error('Checkout failed:', error);
    }
  };

  return (
    <>
      <button
        type="button"
        className="cart-trigger"
        aria-label="Open cart"
        onClick={onOpen}
      >
        Cart
        {hasItems ? <sup className="cart-count">{itemCount}</sup> : null}
      </button>

      {isMounted ? (
        <>
          <div
            className={`cart-overlay ${isClosing ? 'is-closing' : 'is-open'}`}
            aria-hidden="true"
            onClick={onClose}
          />

          <aside
            className={`cart-dialog ${isClosing ? 'is-closing' : 'is-open'}`}
            aria-label="Cart dialog"
            role="dialog"
            aria-modal="true"
          >
            <div className="cart-dialog-header">
              <h2 className="cart-title">Cart</h2>
              <button type="button" className="cart-close" aria-label="Close cart" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>

            <div className="cart-dialog-body">
              {items.length === 0 ? (
                <p className="cart-empty">Your cart is currently empty.</p>
              ) : (
                items.map((item) => (
                  <article
                    key={item.id}
                    className={`cart-item-row ${exitingItemIds.includes(item.id) ? 'is-exiting' : ''}`}
                  >
                    <img className="cart-item-image" src={item.image} alt={item.name} />

                    <div className="cart-item-content">
                      <div className="cart-item-top">
                        <h3 className="cart-item-name">{item.name}</h3>
                        <button
                          type="button"
                          className="cart-item-remove"
                          aria-label={`Remove ${item.name}`}
                          disabled={isControlLocked}
                          onClick={() => animateAndRemove(item.id)}
                        >
                          <CloseIcon />
                        </button>
                      </div>

                      <p className="cart-item-meta">Size: {item.size}</p>
                      <p className="cart-item-price">{formatPrice(item.price)}</p>

                      <div
                        className={`cart-item-qty ${isControlLocked ? 'is-disabled' : ''}`}
                        aria-label="Quantity selector"
                      >
                        <button
                          type="button"
                          onClick={() => handleDecrementClick(item)}
                          aria-label="Decrease quantity"
                          disabled={isControlLocked}
                        >
                          -
                        </button>
                        <span><b>{item.quantity}</b></span>
                        <button
                          type="button"
                          onClick={() => handleIncrementClick(item.id)}
                          aria-label="Increase quantity"
                          disabled={isControlLocked}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>

            <footer className="cart-dialog-footer">
              <div className="cart-subtotal-row">
                <span>Subtotal</span>
                {isSubtotalLoading ? (
                  <span className="cart-subtotal-loader" aria-label="Updating subtotal" role="status" />
                ) : (
                  <span>{formatPrice(subtotal)} USD</span>
                )}
              </div>
              <button type="button"
                className="cart-checkout"
                disabled={isCheckoutDisabled}
                onClick={handleCheckout}
              >
                Check Out
              </button>
              <p className="cart-footnote">Shipping, taxes, and discount codes are calculated at checkout</p>
            </footer>
          </aside>
        </>
      ) : null}
    </>
  );
}

export default Cart;
