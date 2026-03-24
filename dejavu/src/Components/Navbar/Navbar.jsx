import { Fragment, useState, useEffect } from 'react';
import { API_URL } from '../../config/api';
import './Navbar.css';

const NAV_LINKS = [
  { label: 'Shop', page: 'shop' },
  { label: 'Collections', page: 'collections' },
  { label: 'Index', page: 'index' },
  { label: 'Stockist', page: 'stockist' },
  { label: 'About', page: 'about' },
  { label: 'Contact', page: 'contact' },
  { label: 'Account', page: 'account' },
];

function Navbar({
  currentPage = 'entry',
  isAccountOpen = false,
  stockistLinks = [],
  collectionsLinks = [],
  activeCollectionId = null,
  onNavigate,
  cartItemCount = 0,
  onOpenCart,
}) {
  const [isStockistExpanded, setIsStockistExpanded] = useState(false);
  const [isCollectionsExpanded, setIsCollectionsExpanded] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setLoggedInUser({ id: payload.id, isAdmin: payload.isAdmin });
      } catch (e) { }
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Login failed');

      localStorage.setItem('adminToken', data.token);
      setLoggedInUser(data.user);
      setEmail('');
      setPassword('');
      window.location.href = '/account';
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setLoggedInUser(null);
  };

  const handleNavClick = (event, page, hash = '') => {
    event.preventDefault();
    if (page === 'stockist') {
      setIsStockistExpanded((prev) => !prev);
      return;
    }

    if (page === 'collections' && !hash) {
      setIsCollectionsExpanded((prev) => !prev);
      if (onNavigate) onNavigate(page);
      return;
    }

    if (page === 'account') {
      setIsStockistExpanded(false);
      setIsCollectionsExpanded(false);
      if (onNavigate) onNavigate(page);
      return;
    }

    setIsStockistExpanded(false);
    if (!hash) setIsCollectionsExpanded(false);
    setIsMobileMenuOpen(false);
    if (onNavigate) onNavigate(page, hash);
  };

  return (
    <aside className="sidebar-nav" aria-label="Primary navigation">
      <header className="mobile-header">
        <a
          className="brand-logo"
          href="#"
          aria-label="Deja Vu home"
          onClick={(event) => handleNavClick(event, 'entry')}
        >
          DÉJA VU
        </a>

        <div className="mobile-actions">
          <button
            type="button"
            className="mobile-cart-btn"
            onClick={onOpenCart}
          >
            Cart {cartItemCount > 0 ? <sup className="mobile-cart-count">{cartItemCount}</sup> : null}
          </button>
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(true)}
          >
            Menu
          </button>
        </div>
      </header>

      <div
        className={`nav-backdrop ${isMobileMenuOpen ? 'is-open' : ''}`}
        aria-hidden="true"
        onClick={() => setIsMobileMenuOpen(false)}
      />

      <div className={`nav-drawer ${isMobileMenuOpen ? 'is-open' : ''}`}>
        <button
          className="mobile-close-btn"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-label="Close menu"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3.5 3.5L12.5 12.5" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="square" />
            <path d="M12.5 3.5L3.5 12.5" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="square" />
          </svg>
        </button>

        <nav className="nav-links">
          {NAV_LINKS.map(({ label, page }) => {
            const isActive =
              currentPage === page ||
              (page === 'account' && isAccountOpen) ||
              (page === 'stockist' && isStockistExpanded) ||
              (page === 'collections' && isCollectionsExpanded);

            return (
              <div key={label} className="nav-item-container">
                <a
                  href="#"
                  className={`nav-link-item${isActive ? ' is-active' : ''}`}
                  onClick={(event) => handleNavClick(event, page)}
                  aria-expanded={(page === 'stockist' && isStockistExpanded) || (page === 'collections' && isCollectionsExpanded) || undefined}
                  aria-controls={page === 'stockist' ? 'stockist-links' : (page === 'collections' ? 'collections-links' : undefined)}
                >
                  {label}
                </a>

                {page === 'stockist' && stockistLinks.length > 0 ? (
                  <div
                    id="stockist-links"
                    className={`stockist-wrapper${isStockistExpanded ? ' is-expanded' : ''}`}
                    aria-hidden={!isStockistExpanded}
                  >
                    <div className="stockist-links" aria-label="Stockist links">
                      {stockistLinks.map(({ label: stockistLabel, href }) => (
                        <a
                          key={stockistLabel}
                          className="stockist-link-item"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {stockistLabel}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {page === 'collections' && collectionsLinks.length > 0 ? (
                  <div
                    id="collections-links"
                    className={`stockist-wrapper${isCollectionsExpanded ? ' is-expanded' : ''}`}
                    aria-hidden={!isCollectionsExpanded}
                  >
                    <div className="stockist-links" aria-label="Collections links">
                      {collectionsLinks.map(({ id, title }) => (
                        <a
                          key={id}
                          className={`stockist-link-item${activeCollectionId === id ? ' is-active' : ''}`}
                          href={`#collection-${id}`}
                          onClick={(event) => handleNavClick(event, 'collections', `#collection-${id}`)}
                        >
                          {title}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <section
          className={`account-panel${isAccountOpen ? ' is-open' : ''}`}
          aria-hidden={!isAccountOpen}
        >
          {loggedInUser ? (
            <div className="account-form" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <p style={{ margin: 0, fontSize: '14px' }}>Welcome back!</p>

              <button
                type="button"
                className="account-login-button"
                onClick={() => window.location.href = '/account'}
              >
                My Account
              </button>

              {loggedInUser.isAdmin && (
                <button
                  type="button"
                  className="account-login-button"
                  onClick={(e) => handleNavClick(e, 'admin')}
                >
                  Admin Dashboard
                </button>
              )}
              <button
                type="button"
                className="account-login-button"
                onClick={handleLogout}
                style={{ background: 'transparent', color: '#000', border: '1px solid #000' }}
              >
                Log Out
              </button>
            </div>
          ) : (
            <form className="account-form" onSubmit={handleLogin}>
              {loginError && <p style={{ color: '#eb5757', fontSize: '13px', margin: '0 0 10px' }}>{loginError}</p>}
              <label className="account-input-label" htmlFor="account-email">
                Email
              </label>
              <input
                className="account-input"
                id="account-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <label className="account-input-label" htmlFor="account-password">
                Password
              </label>
              <input
                className="account-input"
                id="account-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <div className="account-actions">
                <button type="submit" className="account-login-button" disabled={isLoggingIn}>
                  {isLoggingIn ? 'Logging in...' : 'Login'}
                </button>
                <button type="button" className="account-link-button">
                  Create account
                </button>
                <span className="account-action-divider" aria-hidden="true" />
                <button type="button" className="account-link-button">
                  Forgot?
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </aside>
  );
}

export default Navbar;
