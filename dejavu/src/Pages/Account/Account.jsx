import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { API_URL } from '../../config/api';
import { readSession } from '../../lib/session';
import AccountDashboard from './AccountDashboard';
import AccountOrders from './AccountOrders';
import AccountOrderDetail from './AccountOrderDetail';
import './Account.css';

const TABS = [
  { label: 'Dashboard', to: '/account', end: true },
  { label: 'Orders', to: '/account/orders', end: false },
];

function Account() {
  const [session] = useState(readSession);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const token = session?.token;

  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;

    const fetchOrders = async () => {
      try {
        const res = await fetch(`${API_URL}/api/user/orders`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error('We could not load your orders. Please try again.');
        }
        const data = await res.json();
        if (!cancelled) setOrders(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOrders();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!session) {
    return <Navigate to="/entry" replace />;
  }

  let content;
  if (loading) {
    content = <p className="account-note">Loading your orders…</p>;
  } else if (error) {
    content = <p className="account-note account-note--error">{error}</p>;
  } else {
    content = (
      <Routes>
        <Route index element={<AccountDashboard orders={orders} />} />
        <Route path="orders" element={<AccountOrders orders={orders} />} />
        <Route
          path="orders/:orderId"
          element={<AccountOrderDetail orders={orders} />}
        />
        <Route path="*" element={<Navigate to="/account" replace />} />
      </Routes>
    );
  }

  return (
    <div className="account-page">
      <div className="account-inner">
        <h1 className="account-title">Account</h1>

        <nav className="account-tabs" aria-label="Account sections">
          {TABS.map(({ label, to, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `account-tab${isActive ? ' is-active' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {content}
      </div>
    </div>
  );
}

export default Account;
