/**
 * Presentation rules for an order — pure functions, no React, shared by the
 * account pages and the checkout confirmation.
 */

/**
 * The four states a customer sees, keyed by what the backend stores. The admin
 * dashboard writes PAID / SHIPPED / FULFILLED / CANCELLED; DELIVERED and
 * REFUNDED are accepted too so a later backend rename needs no change here.
 */
const STATUS_BY_BACKEND_VALUE = {
  PENDING: 'purchased',
  PAID: 'purchased',
  SHIPPED: 'shipped',
  FULFILLED: 'delivered',
  DELIVERED: 'delivered',
  CANCELLED: 'refunded',
  REFUNDED: 'refunded',
};

const STATUS_LABELS = {
  purchased: 'Purchased',
  shipped: 'Shipped',
  delivered: 'Delivered',
  refunded: 'Refunded',
};

/** `{ key, label }` — `key` picks the indicator colour. Unknown values read as purchased. */
export function orderStatus(status) {
  const key =
    STATUS_BY_BACKEND_VALUE[String(status ?? '').toUpperCase()] ?? 'purchased';
  return { key, label: STATUS_LABELS[key] };
}

function toAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

const roundCents = (amount) => Math.round(amount * 100) / 100;

export function formatMoney(value) {
  const amount = toAmount(value);
  if (amount === null) return null;
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`;
}

export function formatOrderNumber(id) {
  return String(id ?? '')
    .substring(0, 8)
    .toUpperCase();
}

export function formatOrderDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** `priceAtSale` is a unit price. */
export function lineTotal(item) {
  return roundCents((toAmount(item?.priceAtSale) ?? 0) * (item?.quantity ?? 0));
}

export function orderItemCount(order) {
  if (Array.isArray(order?.OrderItem)) {
    return order.OrderItem.reduce((total, item) => total + (item.quantity ?? 0), 0);
  }
  return order?.itemCount ?? 0;
}

/**
 * Subtotal, shipping, tax and total for an order.
 *
 * Only `totalAmount` is stored today, so the subtotal is summed from the line
 * items. `subtotalAmount`, `shippingAmount` and `taxAmount` are used when the
 * API sends them; when it does not, shipping and tax are known to be zero only
 * if the items already add up to the total. Otherwise they stay `null` — the
 * difference cannot be split between the two from here.
 */
export function orderBreakdown(order) {
  const total = toAmount(order?.totalAmount);
  const items = Array.isArray(order?.OrderItem) ? order.OrderItem : null;

  let subtotal = toAmount(order?.subtotalAmount);
  if (subtotal === null && items && items.length > 0) {
    subtotal = roundCents(items.reduce((sum, item) => sum + lineTotal(item), 0));
  }

  let shipping = toAmount(order?.shippingAmount);
  let tax = toAmount(order?.taxAmount);

  if (
    shipping === null &&
    tax === null &&
    subtotal !== null &&
    total !== null &&
    roundCents(total - subtotal) === 0
  ) {
    shipping = 0;
    tax = 0;
  }

  return { subtotal, shipping, tax, total };
}

/**
 * Rows written before the Postgres rewrite hold the address as a JSON string
 * inside the jsonb column; newer rows hold the object.
 */
export function parseShippingAddress(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** A Stripe address as display lines, empty parts dropped. */
export function addressLines(address) {
  if (!address) return [];
  const locality = [
    address.city,
    [address.state, address.postal_code].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return [address.name, address.line1, address.line2, locality, address.country].filter(
    Boolean,
  );
}

/** Every digit but the last four as a bullet: `•••• •••• •••• 4242`. */
export function maskCardNumber(last4) {
  const digits = String(last4 ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

export function cardBrandLabel(brand) {
  if (!brand) return 'Card';
  const known = { amex: 'American Express', diners: 'Diners Club', jcb: 'JCB' };
  const key = String(brand).toLowerCase();
  return known[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}
