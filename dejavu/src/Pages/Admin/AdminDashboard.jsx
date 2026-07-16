import { Fragment, useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../config/api';
import './Admin.css';

const EMPTY_FORM = {
  id: null,
  name: '',
  price: '',
  stripeProductId: '',
  status: 'ACTIVE',
  imagesText: '',
  descriptionHeading: '',
  descriptionParagraphs: '',
  descriptionModelNote: '',
  sizeGuideText: '',
};

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function productToForm(product) {
  let description = null;
  try {
    description =
      typeof product.description === 'string'
        ? JSON.parse(product.description)
        : product.description;
  } catch {
    description = null;
  }

  let sizeGuideText = '';
  if (product.sizeGuide) {
    try {
      const parsed =
        typeof product.sizeGuide === 'string'
          ? JSON.parse(product.sizeGuide)
          : product.sizeGuide;
      sizeGuideText = JSON.stringify(parsed, null, 2);
    } catch {
      sizeGuideText = typeof product.sizeGuide === 'string' ? product.sizeGuide : '';
    }
  }

  return {
    id: product.id,
    name: product.name ?? '',
    price: product.price ?? '',
    stripeProductId: product.stripeProductId ?? '',
    status: product.status ?? 'ACTIVE',
    imagesText: (product.images ?? []).join('\n'),
    descriptionHeading: description?.heading ?? '',
    descriptionParagraphs: (description?.paragraphs ?? []).join('\n\n'),
    descriptionModelNote: description?.modelNote ?? '',
    sizeGuideText,
  };
}

function AdminDashboard({ token, onLogout }) {
  const [activeTab, setActiveTab] = useState('products'); // 'products' | 'orders' | 'product_form'
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [expandedProductId, setExpandedProductId] = useState(null);
  const [stockDrafts, setStockDrafts] = useState({});
  const [savingVariantId, setSavingVariantId] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const showNotice = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  };

  const fetchProducts = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/products`);
    if (!res.ok) throw new Error('Failed to fetch products');
    setProducts(await res.json());
  }, []);

  const fetchOrders = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/admin/orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Your session has expired. Please log in again.');
    }
    if (!res.ok) throw new Error('Failed to fetch orders');
    setOrders(await res.json());
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (activeTab === 'products') await fetchProducts();
        else if (activeTab === 'orders') await fetchOrders();
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, fetchProducts, fetchOrders]);

  const handleStockSave = async (variantId) => {
    const draft = stockDrafts[variantId];
    if (draft === undefined || draft === '' || Number.isNaN(Number(draft))) return;

    setSavingVariantId(variantId);
    try {
      const res = await fetch(`${API_URL}/api/admin/inventory/${variantId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ stock: Number(draft) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to update stock');
      }
      setStockDrafts((prev) => {
        const next = { ...prev };
        delete next[variantId];
        return next;
      });
      await fetchProducts();
      showNotice('Stock updated');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingVariantId(null);
    }
  };

  const handleStatusToggle = async (product) => {
    const nextStatus = product.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      const res = await fetch(`${API_URL}/api/admin/products/${product.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to update product status');
      }
      await fetchProducts();
      showNotice(`Product ${nextStatus === 'ACTIVE' ? 'activated' : 'archived'}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditProduct = (product) => {
    setForm(productToForm(product));
    setActiveTab('product_form');
  };

  const handleNewProduct = () => {
    setForm(EMPTY_FORM);
    setActiveTab('product_form');
  };

  const handleFormChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleProductSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    const images = form.imagesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const paragraphs = form.descriptionParagraphs
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean);

    const description = JSON.stringify({
      heading: form.descriptionHeading.trim(),
      paragraphs,
      modelNote: form.descriptionModelNote.trim(),
    });

    let sizeGuide = null;
    if (form.sizeGuideText.trim()) {
      try {
        sizeGuide = JSON.stringify(JSON.parse(form.sizeGuideText));
      } catch {
        setError('Size guide must be valid JSON');
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      price: Number(form.price),
      stripeProductId: form.stripeProductId.trim(),
      status: form.status,
      images,
      description,
      ...(sizeGuide ? { sizeGuide } : {}),
    };

    if (!payload.name || !payload.stripeProductId || !Number.isFinite(payload.price) || images.length === 0) {
      setError('Name, price, Stripe product ID, and at least one image are required');
      return;
    }

    setIsSavingProduct(true);
    try {
      const isEdit = Boolean(form.id);
      const res = await fetch(
        isEdit
          ? `${API_URL}/api/admin/products/${form.id}`
          : `${API_URL}/api/admin/products`,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: authHeaders,
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to save product');
      }

      setForm(EMPTY_FORM);
      setActiveTab('products');
      showNotice(isEdit ? 'Product updated' : 'Product created');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleOrderStatusChange = async (orderId, status) => {
    try {
      const res = await fetch(`${API_URL}/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to update order status');
      }
      await fetchOrders();
      showNotice('Order status updated');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">VUJA DÉ — Admin</h1>
          <p className="admin-subtitle">Inventory, products, and orders</p>
        </div>
        <div className="admin-header-actions">
          <a className="admin-link" href="/pages/shop">View storefront</a>
          <button className="admin-btn admin-btn--ghost" onClick={onLogout}>Log Out</button>
        </div>
      </header>

      <div className="admin-dashboard-tabs">
        <button
          className={`admin-tab ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          Inventory
        </button>
        <button
          className={`admin-tab ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
        >
          Orders
        </button>
        <button
          className={`admin-tab ${activeTab === 'product_form' ? 'active' : ''}`}
          onClick={handleNewProduct}
        >
          {form.id && activeTab === 'product_form' ? 'Edit Product' : 'Add Product'}
        </button>
      </div>

      {notice && <p className="admin-notice">{notice}</p>}
      {error && <p className="admin-error">{error}</p>}

      {loading ? (
        <p className="admin-loading">Loading…</p>
      ) : (
        <>
          {activeTab === 'products' && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Total Stock</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const variants = product.ProductVariant ?? [];
                  const totalStock = variants.reduce(
                    (sum, v) => sum + (Number(v.stock) || 0),
                    0,
                  );
                  const isExpanded = expandedProductId === product.id;

                  return (
                    <Fragment key={product.id}>
                      <tr>
                        <td>
                          <div className="admin-product-cell">
                            {product.images?.[0] ? (
                              <img
                                className="admin-product-thumb"
                                src={product.images[0]}
                                alt={product.name}
                              />
                            ) : null}
                            <span>{product.name}</span>
                          </div>
                        </td>
                        <td>{formatMoney(product.price)}</td>
                        <td>{variants.length > 0 ? totalStock : '—'}</td>
                        <td>
                          <button
                            className={`admin-status-pill ${product.status === 'ACTIVE' ? 'is-active' : ''}`}
                            onClick={() => handleStatusToggle(product)}
                            title="Toggle ACTIVE / ARCHIVED"
                          >
                            {product.status}
                          </button>
                        </td>
                        <td className="admin-row-actions">
                          <button
                            className="admin-link-btn"
                            onClick={() =>
                              setExpandedProductId(isExpanded ? null : product.id)
                            }
                          >
                            {isExpanded ? 'Hide stock' : 'Edit stock'}
                          </button>
                          <button
                            className="admin-link-btn"
                            onClick={() => handleEditProduct(product)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="admin-variant-row">
                          <td colSpan={5}>
                            {variants.length === 0 ? (
                              <p className="admin-empty">No variants for this product.</p>
                            ) : (
                              <div className="admin-variant-grid">
                                {variants.map((variant) => (
                                  <div key={variant.id} className="admin-variant-item">
                                    <span className="admin-variant-size">
                                      {variant.size}
                                    </span>
                                    <input
                                      className="admin-variant-input"
                                      type="number"
                                      min="0"
                                      value={stockDrafts[variant.id] ?? variant.stock ?? 0}
                                      onChange={(e) =>
                                        setStockDrafts((prev) => ({
                                          ...prev,
                                          [variant.id]: e.target.value,
                                        }))
                                      }
                                    />
                                    <button
                                      className="admin-btn"
                                      disabled={
                                        savingVariantId === variant.id ||
                                        stockDrafts[variant.id] === undefined
                                      }
                                      onClick={() => handleStockSave(variant.id)}
                                    >
                                      {savingVariantId === variant.id ? 'Saving…' : 'Save'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {activeTab === 'orders' && (
            <div className="admin-orders-list">
              {orders.length === 0 ? (
                <p className="admin-empty">No orders yet.</p>
              ) : (
                orders.map((order) => {
                  let shipping = null;
                  try {
                    shipping =
                      typeof order.shippingAddress === 'string'
                        ? JSON.parse(order.shippingAddress)
                        : order.shippingAddress;
                  } catch {
                    shipping = null;
                  }

                  return (
                    <div key={order.id} className="admin-panel admin-order-card">
                      <div className="admin-order-head">
                        <div>
                          <p className="admin-order-email">
                            {order.customerEmail || order.User?.email || 'Guest'}
                          </p>
                          <p className="admin-order-meta">
                            {order.id.substring(0, 8).toUpperCase()} ·{' '}
                            {new Date(order.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="admin-order-controls">
                          <span className="admin-order-total">
                            {formatMoney(order.totalAmount)}
                          </span>
                          <select
                            className="admin-select"
                            value={order.status}
                            onChange={(e) =>
                              handleOrderStatusChange(order.id, e.target.value)
                            }
                          >
                            <option value="PAID">PAID</option>
                            <option value="SHIPPED">SHIPPED</option>
                            <option value="FULFILLED">FULFILLED</option>
                            <option value="CANCELLED">CANCELLED</option>
                          </select>
                        </div>
                      </div>

                      {shipping && (
                        <p className="admin-order-shipping">
                          Ships to:{' '}
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
                      )}

                      {order.OrderItem?.length > 0 && (
                        <table className="admin-table admin-table--nested">
                          <thead>
                            <tr>
                              <th>Item</th>
                              <th>Qty</th>
                              <th>Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.OrderItem.map((item) => (
                              <tr key={item.id}>
                                <td>
                                  {item.ProductVariant?.Product?.name ??
                                    (item.variantId
                                      ? `${item.variantId.substring(0, 8)}…`
                                      : '—')}
                                  {item.ProductVariant?.size
                                    ? ` — ${item.ProductVariant.size}`
                                    : ''}
                                </td>
                                <td>{item.quantity}</td>
                                <td>{formatMoney(item.priceAtSale)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'product_form' && (
            <form className="admin-panel admin-product-form" onSubmit={handleProductSubmit}>
              <h2 className="admin-form-title">
                {form.id ? 'Edit Product' : 'New Product'}
              </h2>

              <div className="admin-form-row">
                <div className="admin-form-group">
                  <label htmlFor="admin-name">Name</label>
                  <input
                    id="admin-name"
                    type="text"
                    value={form.name}
                    onChange={handleFormChange('name')}
                    required
                  />
                </div>
                <div className="admin-form-group">
                  <label htmlFor="admin-price">Price (USD)</label>
                  <input
                    id="admin-price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.price}
                    onChange={handleFormChange('price')}
                    required
                  />
                </div>
              </div>

              <div className="admin-form-row">
                <div className="admin-form-group">
                  <label htmlFor="admin-stripe-id">Stripe Product ID</label>
                  <input
                    id="admin-stripe-id"
                    type="text"
                    placeholder="prod_…"
                    value={form.stripeProductId}
                    onChange={handleFormChange('stripeProductId')}
                    required
                  />
                </div>
                <div className="admin-form-group">
                  <label htmlFor="admin-status">Status</label>
                  <select
                    id="admin-status"
                    className="admin-select"
                    value={form.status}
                    onChange={handleFormChange('status')}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>
              </div>

              <div className="admin-form-group">
                <label htmlFor="admin-images">Image URLs (one per line)</label>
                <textarea
                  id="admin-images"
                  rows={3}
                  value={form.imagesText}
                  onChange={handleFormChange('imagesText')}
                  required
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor="admin-desc-heading">Description heading</label>
                <input
                  id="admin-desc-heading"
                  type="text"
                  value={form.descriptionHeading}
                  onChange={handleFormChange('descriptionHeading')}
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor="admin-desc-paragraphs">
                  Description paragraphs (separate with a blank line)
                </label>
                <textarea
                  id="admin-desc-paragraphs"
                  rows={6}
                  value={form.descriptionParagraphs}
                  onChange={handleFormChange('descriptionParagraphs')}
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor="admin-desc-model">Model note</label>
                <input
                  id="admin-desc-model"
                  type="text"
                  placeholder="Model is 183cm/6ft wearing size Medium"
                  value={form.descriptionModelNote}
                  onChange={handleFormChange('descriptionModelNote')}
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor="admin-size-guide">Size guide JSON (optional)</label>
                <textarea
                  id="admin-size-guide"
                  rows={6}
                  placeholder='{"columns": ["S", "M", "L"], "measurements": {"Chest": [52, 54, 56]}}'
                  value={form.sizeGuideText}
                  onChange={handleFormChange('sizeGuideText')}
                />
              </div>

              <div className="admin-form-actions">
                <button className="admin-btn" type="submit" disabled={isSavingProduct}>
                  {isSavingProduct
                    ? 'Saving…'
                    : form.id
                      ? 'Save Changes'
                      : 'Create Product'}
                </button>
                {form.id && (
                  <button
                    className="admin-btn admin-btn--ghost"
                    type="button"
                    onClick={handleNewProduct}
                  >
                    Clear / New
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

export default AdminDashboard;
