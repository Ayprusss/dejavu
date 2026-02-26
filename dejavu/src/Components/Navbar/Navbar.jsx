import './Navbar.css';

const NAV_LINKS = [
  { label: 'Shop', page: 'shop' },
  { label: 'Collections', page: 'collections' },
  { label: 'Index', page: 'index' },
  { label: 'Stockist', page: 'stockist' },
  { label: 'About', page: 'about' },
  { label: 'Contact', page: 'contact' },
  { label: 'My Account', page: 'account' },
];

function Navbar({ currentPage = 'shop', onNavigate }) {
  const handleNavClick = (event, page) => {
    event.preventDefault();
    if (onNavigate) onNavigate(page);
  };

  return (
    <aside className="sidebar-nav" aria-label="Primary navigation">
      <a
        className="brand-logo"
        href="#"
        aria-label="Deja Vu home"
        onClick={(event) => handleNavClick(event, 'shop')}
      >
        DÉJA VU
      </a>

      <nav className="nav-links">
        {NAV_LINKS.map(({ label, page }) => (
          <a
            key={label}
            href="#"
            className={`nav-link-item${currentPage === page ? ' is-active' : ''}`}
            onClick={(event) => handleNavClick(event, page)}
          >
            {label}
          </a>
        ))}
      </nav>
    </aside>
  );
}

export default Navbar;