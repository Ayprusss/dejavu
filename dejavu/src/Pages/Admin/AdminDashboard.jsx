import { useEffect, useState } from 'react';
import './Admin.css';

function AdminDashboard({ token, onLogout }) {
  const [activeTab, setActiveTab] = useState('products'); // 'products', 'orders', 'add_product'
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'products') {
        const res = await fetch('http://localhost:5000/api/products');
        if (!res.ok) throw new Error('Failed to fetch products');
        const data = await res.json();
        setProducts(data);
      } else if (activeTab === 'orders') {
        const res = await fetch('http://localhost:5000/api/admin/orders', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch orders');
        const data = await res.json();
        setOrders(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStock = async (variantId, currentStock) => {
    const newStock = window.prompt("Enter new stock level:", currentStock);
    if (newStock === null || isNaN(newStock)) return;

    try {
      const res = await fetch(`http://localhost:5000/api/admin/inventory/${variantId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ stock: Number(newStock) })
      });
      if (!res.ok) throw new Error('Failed to update stock');
      alert('Stock updated successfully');
      fetchData(); // Refresh list
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <header className="admin-header">
        <h1 className="admin-title">Dashboard</h1>
        <button className="admin-btn" onClick={onLogout}>Log Out</button>
      </header>

      <div className="admin-dashboard-tabs">
        <button 
          className={`admin-tab ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          Inventory
        </button>
        <button 
          className={`admin-tab ${activeTab === 'add_product' ? 'active' : ''}`}
          onClick={() => setActiveTab('add_product')}
        >
          Add Product
        </button>
        <button 
          className={`admin-tab ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
        >
          Orders
        </button>
      </div>

      {error && <p className="admin-error" style={{ marginBottom: '15px' }}>{error}</p>}
      {loading ? <p>Loading data...</p> : (
        <>
          {activeTab === 'products' && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>${p.price}</td>
                    <td>{p.status}</td>
                    <td>
                      <button className="admin-btn" onClick={() => alert('View variants to edit stock. Needs expansion.')}>Edit Stock</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeTab === 'orders' && (
            <div className="admin-orders-list">
              {orders.length === 0 ? (
                <p>No orders yet.</p>
              ) : (
                orders.map(o => {
                  let shipping = null;
                  try { shipping = typeof o.shippingAddress === 'string' ? JSON.parse(o.shippingAddress) : o.shippingAddress; } catch { /* ignore */ }

                  return (
                    <div key={o.id} className="admin-panel" style={{ marginBottom: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div>
                          <strong>{o.customerEmail || 'Guest'}</strong>
                          <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                            {o.id.substring(0, 8)}… · {new Date(o.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '600', marginBottom: '6px' }}>${o.totalAmount}</div>
                          <select
                            value={o.status}
                            onChange={async (e) => {
                              try {
                                const res = await fetch(`http://localhost:5000/api/admin/orders/${o.id}/status`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                  body: JSON.stringify({ status: e.target.value })
                                });
                                if (!res.ok) throw new Error('Failed');
                                fetchData();
                              } catch (err) { alert(err.message); }
                            }}
                            style={{ padding: '4px 8px', fontSize: '13px', border: '1px solid #ccc', fontFamily: 'inherit' }}
                          >
                            <option value="PAID">PAID</option>
                            <option value="SHIPPED">SHIPPED</option>
                            <option value="FULFILLED">FULFILLED</option>
                            <option value="CANCELLED">CANCELLED</option>
                          </select>
                        </div>
                      </div>

                      {shipping && (
                        <div style={{ fontSize: '13px', color: '#555', marginBottom: '12px', padding: '10px', background: '#fafafa', border: '1px solid #eaeaea' }}>
                          <strong style={{ color: '#000' }}>Ship to:</strong>{' '}
                          {[shipping.line1, shipping.line2, shipping.city, shipping.state, shipping.postal_code, shipping.country].filter(Boolean).join(', ')}
                        </div>
                      )}

                      {o.OrderItem && o.OrderItem.length > 0 && (
                        <table className="admin-table" style={{ marginTop: '0' }}>
                          <thead>
                            <tr>
                              <th>Variant ID</th>
                              <th>Qty</th>
                              <th>Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.OrderItem.map(item => (
                              <tr key={item.id}>
                                <td style={{ fontSize: '13px' }}>{item.variantId ? item.variantId.substring(0, 8) + '…' : '—'}</td>
                                <td>{item.quantity}</td>
                                <td>${item.priceAtSale}</td>
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

          {activeTab === 'add_product' && (
             <div className="admin-panel">
               <p>Here you would put the form to submit a new product to `POST /api/admin/products`.</p>
               <button className="admin-btn admin-btn--highlight">Save New Product</button>
             </div>
          )}
        </>
      )}
    </div>
  );
}

export default AdminDashboard;
