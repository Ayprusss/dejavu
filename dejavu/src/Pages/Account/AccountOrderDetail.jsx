import { Link, useParams } from 'react-router-dom';
import OrderReceipt from '../../Components/OrderReceipt/OrderReceipt';
import OrderStatus from '../../Components/OrderStatus/OrderStatus';
import { formatOrderDate, formatOrderNumber } from '../../lib/orders';

function AccountOrderDetail({ orders }) {
  const { orderId } = useParams();
  const order = orders.find((candidate) => candidate.id === orderId);

  if (!order) {
    return (
      <>
        <p className="account-note">We could not find that order.</p>
        <Link to="/account/orders" className="account-link">
          Back to all orders
        </Link>
      </>
    );
  }

  return (
    <article className="account-order">
      <Link to="/account/orders" className="account-link">
        Back to all orders
      </Link>

      <header className="account-order-head">
        <div>
          <h2 className="account-heading">Order {formatOrderNumber(order.id)}</h2>
          <p className="account-order-meta">
            Placed {formatOrderDate(order.createdAt)}
            {order.customerEmail ? ` · ${order.customerEmail}` : ''}
          </p>
        </div>
        <OrderStatus status={order.status} />
      </header>

      <OrderReceipt order={order} />
    </article>
  );
}

export default AccountOrderDetail;
