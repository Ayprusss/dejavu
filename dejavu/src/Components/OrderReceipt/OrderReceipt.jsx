import {
  addressLines,
  cardBrandLabel,
  formatMoney,
  lineTotal,
  maskCardNumber,
  orderBreakdown,
  orderItemCount,
  parseShippingAddress,
} from '../../lib/orders';
import './OrderReceipt.css';

/**
 * Items, totals, shipping address and payment card for one order.
 *
 * Renders whatever the API sent: an owner's order carries line items and an
 * address, while the public shape of GET /api/checkout/session/:id carries
 * only a total and an item count, so every section is optional.
 */
function OrderReceipt({ order }) {
  const items = Array.isArray(order.OrderItem) ? order.OrderItem : [];
  const { subtotal, shipping, tax, total } = orderBreakdown(order);
  const address = addressLines(parseShippingAddress(order.shippingAddress));
  const cardNumber = maskCardNumber(order.paymentMethod?.last4);
  const itemCount = orderItemCount(order);

  return (
    <div className="order-receipt">
      {items.map((item) => {
        const product = item.ProductVariant?.Product;
        const size = item.ProductVariant?.size;
        const image = product?.images?.[0];

        return (
          <div key={item.id} className="order-receipt-item">
            {image ? (
              <img
                className="order-receipt-item-image"
                src={image}
                alt={product?.name ?? 'Ordered item'}
              />
            ) : (
              <span className="order-receipt-item-image" aria-hidden="true" />
            )}
            <div className="order-receipt-item-info">
              <p className="order-receipt-item-name">{product?.name ?? 'Item'}</p>
              <p className="order-receipt-item-meta">
                {size ? `Size: ${size} · ` : ''}
                Qty: {item.quantity}
                {item.quantity > 1 ? ` · ${formatMoney(item.priceAtSale)} each` : ''}
              </p>
            </div>
            <span className="order-receipt-item-price">
              {formatMoney(lineTotal(item))}
            </span>
          </div>
        );
      })}

      <dl className="order-receipt-totals">
        {items.length === 0 && itemCount > 0 ? (
          <div className="order-receipt-row">
            <dt>Items</dt>
            <dd>{itemCount}</dd>
          </div>
        ) : null}
        {subtotal !== null ? (
          <>
            <div className="order-receipt-row">
              <dt>Subtotal</dt>
              <dd>{formatMoney(subtotal)}</dd>
            </div>
            <div className="order-receipt-row">
              <dt>Shipping</dt>
              <dd>{formatMoney(shipping) ?? 'Included in total'}</dd>
            </div>
            <div className="order-receipt-row">
              <dt>Tax</dt>
              <dd>{formatMoney(tax) ?? 'Included in total'}</dd>
            </div>
          </>
        ) : null}
        <div className="order-receipt-row order-receipt-row--total">
          <dt>Total</dt>
          <dd>{formatMoney(total)}</dd>
        </div>
      </dl>

      {address.length > 0 || cardNumber ? (
        <div className="order-receipt-details">
          {address.length > 0 ? (
            <div className="order-receipt-detail">
              <p className="order-receipt-heading">Ships to</p>
              {address.map((line) => (
                <p key={line} className="order-receipt-line">
                  {line}
                </p>
              ))}
            </div>
          ) : null}

          {cardNumber ? (
            <div className="order-receipt-detail">
              <p className="order-receipt-heading">Payment</p>
              <p className="order-receipt-line">
                {cardBrandLabel(order.paymentMethod.brand)}
              </p>
              <p
                className="order-receipt-line order-receipt-card"
                aria-label={`Card ending in ${cardNumber.slice(-4)}`}
              >
                {cardNumber}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default OrderReceipt;
