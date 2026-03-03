import { useState } from 'react';
import TermsDialog from '../TermsDialog/TermsDialog';
import ShippingDialog from '../ShippingDialog/ShippingDialog';
import './Footer.css';

const FOOTER_LINKS = ['Terms & Conditions', 'Shipping & Returns', 'Social'];

function Footer() {
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isShippingOpen, setIsShippingOpen] = useState(false);

  const handleLinkClick = (e, label) => {
    if (label === 'Terms & Conditions') {
      e.preventDefault();
      setIsTermsOpen(true);
    } else if (label === 'Shipping & Returns') {
      e.preventDefault();
      setIsShippingOpen(true);
    }
  };

  return (
    <>
      <footer className="site-footer" aria-label="Footer links">
        <nav className="footer-links">
          {FOOTER_LINKS.map((label) => {
            const isSocial = label === 'Social';
            return (
              <a
                key={label}
                href={isSocial ? 'https://www.instagram.com/vujadestudio/' : '#'}
                className="footer-link-item"
                onClick={isSocial ? undefined : (e) => handleLinkClick(e, label)}
                target={isSocial ? '_blank' : undefined}
                rel={isSocial ? 'noopener noreferrer' : undefined}
              >
                {label}
              </a>
            );
          })}
        </nav>
      </footer>
      <TermsDialog isOpen={isTermsOpen} onClose={() => setIsTermsOpen(false)} />
      <ShippingDialog isOpen={isShippingOpen} onClose={() => setIsShippingOpen(false)} />
    </>
  );
}

export default Footer;
