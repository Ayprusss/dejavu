import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './Index.css';

export const INDEX_IMAGES = [
  {
    id: "contrast-stitch",
    label: "Contrast Stitch Longsleeve Top + Grisaille Belt",
    src: "/index/DSC5535_SnapseedCopy.webp"
  },
  {
    id: "everyday-bag",
    label: "Everyday bag",
    src: "/index/everydayBag.webp"
  },
  {
    id: "special-label",
    label: "Special Label",
    src: "/index/Special_Label.webp"
  },
  {
    id: "aw25-backstage",
    label: "AW25 Backstage shot of james and mohammed",
    src: "/index/AW25_Backstage_shot_of_james_and_mohammed.webp"
  }
];

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
