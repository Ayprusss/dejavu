import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import AdminDashboard from './AdminDashboard';
import './Admin.css';

function decodeToken(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

function getValidAdminToken() {
  const savedToken = localStorage.getItem('adminToken');
  if (!savedToken) return null;

  const payload = decodeToken(savedToken);
  const isExpired = payload?.exp && payload.exp * 1000 < Date.now();

  return payload?.isAdmin && !isExpired ? savedToken : null;
}

function Admin() {
  const [token] = useState(getValidAdminToken);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    window.location.href = '/entry';
  };

  if (!token) {
    return <Navigate to="/entry" replace />;
  }

  return (
    <div className="admin-page">
      <AdminDashboard token={token} onLogout={handleLogout} />
    </div>
  );
}

export default Admin;
