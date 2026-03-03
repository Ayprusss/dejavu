import { Fragment, useState } from 'react';
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
  onNavigate,
}) {
  const [isStockistExpanded, setIsStockistExpanded] = useState(false);

  const handleNavClick = (event, page) => {
    event.preventDefault();
    if (page === 'stockist') {
      setIsStockistExpanded((prev) => !prev);
      return;
    }

    setIsStockistExpanded(false);
    if (onNavigate) onNavigate(page);
  };

  return (
    <aside className="sidebar-nav" aria-label="Primary navigation">
      <a
        className="brand-logo"
        href="#"
        aria-label="Deja Vu home"
        onClick={(event) => handleNavClick(event, 'entry')}
      >
        DÉJA VU
      </a>

      <nav className="nav-links">
        {NAV_LINKS.map(({ label, page }) => {
          const isActive =
            currentPage === page ||
            (page === 'account' && isAccountOpen) ||
            (page === 'stockist' && isStockistExpanded);

          return (
            <div key={label} className="nav-item-container">
              <a
                href="#"
                className={`nav-link-item${isActive ? ' is-active' : ''}`}
                onClick={(event) => handleNavClick(event, page)}
                aria-expanded={page === 'stockist' ? isStockistExpanded : undefined}
                aria-controls={page === 'stockist' ? 'stockist-links' : undefined}
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
            </div>
          );
        })}
      </nav>

      <section
        className={`account-panel${isAccountOpen ? ' is-open' : ''}`}
        aria-hidden={!isAccountOpen}
      >
        <form className="account-form" action="#" method="post">
          <label className="account-input-label" htmlFor="account-email">
            Email
          </label>
          <input
            className="account-input"
            id="account-email"
            name="email"
            type="email"
            autoComplete="email"
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
          />

          <div className="account-actions">
            <button type="submit" className="account-login-button">
              Login
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
      </section>
    </aside>
  );
}

export default Navbar;
