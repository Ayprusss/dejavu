import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { API_URL } from '../../config/api';
import './Account.css';

function Account() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('adminToken');
    if (savedToken) {
      setToken(savedToken);
      try {
        const payload = JSON.parse(atob(savedToken.split('.')[1]));
        setUser({ id: payload.id, isAdmin: payload.isAdmin });
      } catch (e) {
        // Invalid token payload
      }
    }
    setIsInitializing(false);
  }, []);

  useEffect(() => {
    if (!token) return;

    const fetchOrders = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/api/user/orders`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          throw new Error('Failed to fetch order history');
        }
        const data = await res.json();
        setOrders(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [token]);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    window.location.href = '/entry';
  };

  if (isInitializing) return null;

  if (!token) {
    return <Navigate to="/entry" replace />;
  }

  return (
    <div className="account-page">
      <header className="account-header">
        <h1 className="account-title">My Account</h1>
        <div style={{ display: 'flex', gap: '15px' }}>
          {user?.isAdmin && (
            <button className="account-btn account-btn--highlight" onClick={() => window.location.href = '/admin'}>
              Admin Dashboard
            </button>
          )}
          <button className="account-btn" onClick={handleLogout}>Log Out</button>
        </div>
      </header>

      <div className="account-panel">
        <h2 className="account-subtitle">Order History</h2>
        
        {loading ? (
          <p>Loading your orders...</p>
        ) : error ? (
          <p className="account-error">{error}</p>
        ) : orders.length === 0 ? (
          <p>You haven't placed any orders yet.</p>
        ) : (
          <div className="account-orders-list">
            {orders.map(order => (
              <div key={order.id} className="account-order-card">
                <div className="account-order-header">
                  <div>
                    <strong>Order #{order.id.substring(0, 8)}</strong>
                    <div className="account-order-date">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="account-order-status">
                    <div>{order.status}</div>
                    <strong>${order.totalAmount.toFixed(2)}</strong>
                  </div>
                </div>
                
                <table className="account-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Size</th>
                      <th>Qty</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.OrderItem?.map(item => {
                      // Safety checks for nested Supabase response
                      const product = item.ProductVariant?.Product;
                      const size = item.ProductVariant?.size || 'N/A';
                      const name = product ? product.name : 'Unknown Product';
                      
                      return (
                        <tr key={item.id}>
                          <td>{name}</td>
                          <td>{size}</td>
                          <td>{item.quantity}</td>
                          <td>${Number(item.priceAtSale).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Account;
