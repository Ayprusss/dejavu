import { orderStatus } from '../../lib/orders';
import './OrderStatus.css';

function OrderStatus({ status }) {
  const { key, label } = orderStatus(status);

  return (
    <span className={`order-status order-status--${key}`}>
      <span className="order-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export default OrderStatus;
