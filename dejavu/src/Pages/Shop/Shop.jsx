import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './Shop.css';
import { PRODUCTS } from '../../data/products';

function Shop() {
  const [isGridVisible, setIsGridVisible] = useState(false);

  useEffect(() => {
    const loadImages = async () => {
      // Get all primary images we need to load
      const imageUrls = PRODUCTS.filter((item) => item.images?.[0]).map(
        (item) => item.images[0].src
      );

      if (imageUrls.length === 0) {
        setIsGridVisible(true);
        return;
      }

      try {
        await Promise.all(
          imageUrls.map((src) => {
            return new Promise((resolve, reject) => {
              const img = new Image();
              img.src = src;
              img.onload = resolve;
              img.onerror = resolve; // Resolve on error too to avoid blocking the whole page
            });
          })
        );
      } finally {
        // Double requestAnimationFrame ensures browser has painted layout before transition
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsGridVisible(true);
          });
        });
      }
    };

    loadImages();
  }, []);

  return (
    <section className="shop-page" aria-label="Shop products">
      <div className="shop-page-inner">
        <div className={`shop-grid${isGridVisible ? ' shop-grid--visible' : ''}`}>
          {PRODUCTS.map((item) => {
            const primaryImage = item.images?.[0];
            const hoverImage = item.images?.[1];

            return (
              <article
                key={item.id}
                className={`shop-card${hoverImage ? ' shop-card--has-hover' : ''}`}
              >
                <Link className="shop-card-link" to={`/products/${item.id}`}>
                  <div className="shop-card-media">
                    {primaryImage ? (
                      <img
                        className="shop-card-image shop-card-image--primary"
                        src={primaryImage.src}
                        alt={primaryImage.alt ?? item.imageAlt}
                        loading="lazy"
                      />
                    ) : null}
                    {hoverImage ? (
                      <img
                        className="shop-card-image shop-card-image--hover"
                        src={hoverImage.src}
                        alt={hoverImage.alt ?? `${item.imageAlt} alternate view`}
                        loading="lazy"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>

                  <h2 className="shop-card-name">{item.name}</h2>
                  {item.priceLabel ? <p className="shop-card-price">{item.priceLabel}</p> : null}
                  {item.cardStatus ? (
                    <p className={`shop-card-status ${item.cardStatusTone}`}>{item.cardStatus}</p>
                  ) : null}
                </Link>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default Shop;

