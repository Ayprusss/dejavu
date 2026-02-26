import './Footer.css';

const FOOTER_LINKS = ['Terms & Conditions', 'Shipping & Returns', 'Social'];

function Footer() {
  return (
    <footer className="site-footer" aria-label="Footer links">
      <nav className="footer-links">
        {FOOTER_LINKS.map((label) => (
          <a key={label} href="#" className="footer-link-item">
            {label}
          </a>
        ))}
      </nav>
    </footer>
  );
}

export default Footer;
