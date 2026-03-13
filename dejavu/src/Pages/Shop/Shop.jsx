import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './Shop.css';

function Shop() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isGridVisible, setIsGridVisible] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch('http://localhost:5000/api/products');
        if (!response.ok) {
          throw new Error('Failed to fetch products');
        }
        const data = await response.json();
        setProducts(data);
      } catch (err) {
        console.error("Error fetching products:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  useEffect(() => {
    if (products.length === 0) return;

    const loadImages = async () => {
      // Get all primary images we need to load (strings from the API)
      const imageUrls = products.filter((item) => item.images && item.images.length > 0).map(
        (item) => item.images[0]
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
  }, [products]);

  if (loading) return <div style={{ textAlign: "center", padding: "100px 0" }}>Loading products...</div>;
  if (error) return <div style={{ textAlign: "center", padding: "100px 0", color: "red" }}>Error: {error}</div>;

  return (
    <section className="shop-page" aria-label="Shop products">
      <div className="shop-page-inner">
        <div className={`shop-grid${isGridVisible ? ' shop-grid--visible' : ''}`}>
          {products.map((item) => {
            // Our API returns an array of string URLs
            const primaryImage = item.images && item.images.length > 0 ? item.images[0] : null;
            const hoverImage = item.images && item.images.length > 1 ? item.images[1] : null;

            return (
              <article
                key={item.id}
                className={`shop-card${hoverImage ? ' shop-card--has-hover' : ''}`}
              >
                <Link className="shop-card-link" to={`/products/${item.stripeProductId}`}>
                  <div className="shop-card-media">
                    {primaryImage ? (
                      <img
                        className="shop-card-image shop-card-image--primary"
                        src={primaryImage}
                        alt={item.name}
                        loading="lazy"
                      />
                    ) : null}
                    {hoverImage ? (
                      <img
                        className="shop-card-image shop-card-image--hover"
                        src={hoverImage}
                        alt={`${item.name} alternate view`}
                        loading="lazy"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>

                  <h2 className="shop-card-name">{item.name}</h2>
                  <p className="shop-card-price">${item.price}</p>

                  {item.status !== 'ACTIVE' ? (
                    <p className={`shop-card-status critical`}>{item.status}</p>
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

