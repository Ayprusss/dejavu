import { Link } from 'react-router-dom';
import OrderStatus from '../../Components/OrderStatus/OrderStatus';
import {
  formatMoney,
  formatOrderDate,
  formatOrderNumber,
  orderItemCount,
  orderStatus,
} from '../../lib/orders';

const RECENT_ORDER_COUNT = 3;
const MAX_THUMBNAILS = 4;

function AccountDashboard({ orders }) {
  if (orders.length === 0) {
    return (
      <>
        <p className="account-note">You haven&apos;t placed any orders yet.</p>
        <Link to="/pages/shop" className="account-button">
          Visit the shop
        </Link>
      </>
    );
  }

  const statuses = orders.map((order) => orderStatus(order.status).key);
  const inTransit = statuses.filter((key) => key === 'shipped').length;
  const totalSpent = orders.reduce(
    (sum, order, index) =>
      statuses[index] === 'refunded' ? sum : sum + (Number(order.totalAmount) || 0),
    0,
  );

  return (
    <>
      <dl className="account-stats">
        <div className="account-stat">
          <dt>Orders</dt>
          <dd>{orders.length}</dd>
        </div>
        <div className="account-stat">
          <dt>In transit</dt>
          <dd>{inTransit}</dd>
        </div>
        <div className="account-stat">
          <dt>Total spent</dt>
          <dd>{formatMoney(totalSpent)}</dd>
        </div>
      </dl>

      <section aria-labelledby="account-recent-heading">
        <div className="account-section-head">
          <h2 id="account-recent-heading" className="account-heading">
            Previous purchases
          </h2>
          <Link to="/account/orders" className="account-link">
            View all orders
          </Link>
        </div>

        <ul className="account-purchases">
          {orders.slice(0, RECENT_ORDER_COUNT).map((order) => {
            const items = order.OrderItem ?? [];
            const itemCount = orderItemCount(order);

            return (
              <li key={order.id}>
                <Link to={`/account/orders/${order.id}`} className="account-purchase">
                  <div className="account-purchase-thumbs">
                    {items.slice(0, MAX_THUMBNAILS).map((item) => {
                      const product = item.ProductVariant?.Product;
                      const image = product?.images?.[0];
                      return image ? (
                        <img
                          key={item.id}
                          className="account-purchase-thumb"
                          src={image}
                          alt={product.name ?? 'Ordered item'}
                        />
                      ) : (
                        <span
                          key={item.id}
                          className="account-purchase-thumb"
                          aria-hidden="true"
                        />
                      );
                    })}
                  </div>
                  <div className="account-purchase-info">
                    <p className="account-purchase-name">
                      {items[0]?.ProductVariant?.Product?.name ??
                        `Order ${formatOrderNumber(order.id)}`}
                      {items.length > 1 ? ` + ${items.length - 1} more` : ''}
                    </p>
                    <p className="account-purchase-meta">
                      Order {formatOrderNumber(order.id)} ·{' '}
                      {formatOrderDate(order.createdAt)} · {itemCount}{' '}
                      {itemCount === 1 ? 'item' : 'items'}
                    </p>
                    <OrderStatus status={order.status} />
                  </div>
                  <span className="account-purchase-total">
                    {formatMoney(order.totalAmount)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

export default AccountDashboard;
