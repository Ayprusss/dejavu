import { Link } from 'react-router-dom';
import OrderStatus from '../../Components/OrderStatus/OrderStatus';
import {
  formatMoney,
  formatOrderDate,
  formatOrderNumber,
  orderItemCount,
} from '../../lib/orders';

function AccountOrders({ orders }) {
  if (orders.length === 0) {
    return <p className="account-note">You haven&apos;t placed any orders yet.</p>;
  }

  return (
    <div className="account-orders" role="table" aria-label="All orders">
      <div className="account-orders-row account-orders-row--head" role="row">
        <span role="columnheader">Order</span>
        <span role="columnheader">Date</span>
        <span role="columnheader">Items</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="account-orders-total">
          Total
        </span>
      </div>

      {orders.map((order) => (
        <Link
          key={order.id}
          to={`/account/orders/${order.id}`}
          className="account-orders-row"
          role="row"
        >
          <span role="cell" className="account-orders-number">
            {formatOrderNumber(order.id)}
          </span>
          <span role="cell" className="account-orders-date">
            {formatOrderDate(order.createdAt)}
          </span>
          <span role="cell" className="account-orders-items">
            {orderItemCount(order)}
          </span>
          <span role="cell" className="account-orders-status">
            <OrderStatus status={order.status} />
          </span>
          <span role="cell" className="account-orders-total">
            {formatMoney(order.totalAmount)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default AccountOrders;
