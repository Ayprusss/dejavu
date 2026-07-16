import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { INDEX_IMAGES } from '../../data/indexData';
import './Index.css';

function IndexPage({ onActiveIndexChange }) {
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) {
      setTimeout(() => {
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    } else {
      window.scrollTo(0, 0);
    }
  }, [hash]);

  useEffect(() => {
    if (!onActiveIndexChange) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let found = null;
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            found = entry.target.id.replace('index-', '');
          }
        });

        if (found) {
          onActiveIndexChange(found);
        }
      },
      {
        root: null,
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0
      }
    );

    const sections = document.querySelectorAll('.index-section');
    sections.forEach((section) => observer.observe(section));

    return () => {
      sections.forEach((section) => observer.unobserve(section));
      onActiveIndexChange(null);
    };
  }, [onActiveIndexChange]);

  return (
    <div className="index-page">
      {INDEX_IMAGES.map((img) => (
        <section key={img.id} id={`index-${img.id}`} className="index-section">
          <img
            src={img.src}
            alt={img.label}
            loading="lazy"
            className="index-image"
          />
        </section>
      ))}
    </div>
  );
}

export default IndexPage;
