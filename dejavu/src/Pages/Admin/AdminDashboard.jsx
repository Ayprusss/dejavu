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
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id}>
                    <td>{o.id.substring(0, 8)}...</td>
                    <td>{o.customerEmail}</td>
                    <td>{o.status}</td>
                    <td>${o.totalAmount}</td>
                    <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
