import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import AdminDashboard from './AdminDashboard';
import './Admin.css';

function Admin() {
  const [token, setToken] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Check localStorage for an existing token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('adminToken');
    if (savedToken) {
      setToken(savedToken);
    }
    setIsInitializing(false);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    window.location.href = '/entry';
  };

  if (isInitializing) return null;

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
