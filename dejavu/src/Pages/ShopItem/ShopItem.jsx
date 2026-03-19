import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { SIZE_GUIDE_UNITS_LABEL } from '../../data/products';
import { API_URL } from '../../config/api';
import './ShopItem.css';

function getInitialSize(product) {
  if (!product?.sizes?.length) {
    return '';
  }

  if (product.defaultSize) {
    const hasDefaultSize = product.sizes.some((size) => size.label === product.defaultSize);
    if (hasDefaultSize) {
      return product.defaultSize;
    }
  }

  return product.sizes[0].label;
}

function ShopItem({ onAddToCart }) {
  const { productId } = useParams();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedSize, setSelectedSize] = useState('');
  const [isSizeListOpen, setIsSizeListOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState('description');

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await fetch(`${API_URL}/api/products/${productId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch product details');
        }

        const data = await response.json();

        // Transform the Supabase/Express payload to match what this legacy UI expects:
        // Description and sizeGuide are stored as JSON strings in the DB
        let parsedDescription = null;
        try { parsedDescription = typeof data.description === 'string' ? JSON.parse(data.description) : data.description; } catch (e) { }

        let parsedSizeGuide = null;
        try { parsedSizeGuide = typeof data.sizeGuide === 'string' ? JSON.parse(data.sizeGuide) : data.sizeGuide; } catch (e) { }

        const formattedProduct = {
          id: data.id,
          stripeProductId: data.stripeProductId,
          name: data.name,
          priceLabel: `$${data.price} USD`,
          images: data.images?.map(src => ({ src, alt: data.name })) || [],
          description: parsedDescription,
          sizeGuide: parsedSizeGuide,
          sizes: (data.ProductVariant || []).map(variant => ({
            id: variant.id,
            stripePriceId: variant.stripeProductId,
            label: variant.size,
            stock: variant.stock
          }))
        };

        setProduct(formattedProduct);

        // Auto-select the first size like the old getInitialSize
        if (formattedProduct.sizes && formattedProduct.sizes.length > 0) {
          setSelectedSize(formattedProduct.sizes[0].label);
        }
      } catch (err) {
        console.error("Error fetching product:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId]);

  const selectedSizeData = useMemo(
    () => product?.sizes?.find((size) => size.label === selectedSize) ?? null,
    [product, selectedSize],
  );

  if (loading) return <div style={{ textAlign: "center", padding: "100px 0" }}>Loading product details...</div>;
  if (error || !product) {
    return <Navigate to="/pages/shop" replace />;
  }

  const isSelectedSizeSoldOut = !selectedSizeData || Number(selectedSizeData.stock) <= 0;
  const selectedSizeLabel = selectedSizeData
    ? `${selectedSizeData.label}${Number(selectedSizeData.stock) <= 0 ? ' - Sold Out' : ''}`
    : 'Select Size';
  const ctaLabel = isSelectedSizeSoldOut ? 'Sold Out' : 'Add To Cart';
  const priceLabel = product.priceLabel ?? '$0.00 USD';
  const sizeGuideColumns = product.sizeGuide?.columns ?? product.sizes?.map((size) => size.label) ?? [];
  const sizeGuideRows = product.sizeGuide?.measurements ? Object.keys(product.sizeGuide.measurements) : [];

  const handlePanelToggle = (panelName) => {
    setOpenPanel((currentPanel) => (currentPanel === panelName ? null : panelName));
  };

  const handleSizePickerBlur = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsSizeListOpen(false);
    }
  };

  const handleAddToCart = () => {
    if (isSelectedSizeSoldOut || !selectedSize || !selectedSizeData) {
      return;
    }

    onAddToCart?.({
      productId: product.id,
      variantId: selectedSizeData.id,
      stripePriceId: selectedSizeData.stripePriceId,
      size: selectedSize,
      name: product.name,
      price: product.priceLabel,
      image: product.images?.[0]?.src
    });
  };

  return (
    <section className="shop-item-page" aria-label={`${product.name} details`}>
      <div className="shop-item-layout">
        <div className="shop-item-gallery" aria-label={`${product.name} image gallery`}>
          {product.images?.map((image, index) => (
            <img
              key={`${product.id}-${index}`}
              className="shop-item-gallery-image"
              src={image.src}
              alt={image.alt ?? `${product.name} image ${index + 1}`}
              loading={index === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </div>

        <article className="shop-item-info">
          <h1 className="shop-item-title">{product.name}</h1>
          <p className="shop-item-price">{priceLabel}</p>

          <div className={`shop-item-size-picker${isSizeListOpen ? ' is-open' : ''}`} onBlur={handleSizePickerBlur}>
            <button
              type="button"
              className="shop-item-size-trigger"
              aria-haspopup="listbox"
              aria-expanded={isSizeListOpen}
              aria-controls={`shop-item-size-list-${product.id}`}
              onClick={() => setIsSizeListOpen((currentOpen) => !currentOpen)}
            >
              <span>{selectedSizeLabel}</span>
              <span
                className={`shop-item-size-trigger-icon${isSizeListOpen ? ' is-open' : ''}`}
                aria-hidden="true"
              />
            </button>

            <ol
              id={`shop-item-size-list-${product.id}`}
              className="shop-item-size-list"
              role="listbox"
              aria-label="Select a size"
              aria-hidden={!isSizeListOpen}
            >
              {product.sizes?.map((size) => {
                const isSoldOut = Number(size.stock) <= 0;
                const isSelected = selectedSize === size.label;
                const optionLabel = `${size.label}${isSoldOut ? ' - Sold Out' : ''}`;

                return (
                  <li key={size.label} className="shop-item-size-list-item">
                    <button
                      type="button"
                      className={`shop-item-size-option${isSelected ? ' is-selected' : ''}${isSoldOut ? ' is-sold-out' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={isSizeListOpen ? 0 : -1}
                      onClick={() => {
                        setSelectedSize(size.label);
                        setIsSizeListOpen(false);
                      }}
                    >
                      {optionLabel}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <button
            type="button"
            className={`shop-item-cta${isSelectedSizeSoldOut ? ' is-sold-out' : ''}`}
            onClick={handleAddToCart}
            aria-disabled={isSelectedSizeSoldOut}
          >
            {ctaLabel}
          </button>

          <details className={`shop-item-detail-card${openPanel === 'description' ? ' is-open' : ''}`} open>
            <summary
              className="shop-item-detail-summary"
              onClick={(event) => {
                event.preventDefault();
                handlePanelToggle('description');
              }}
            >
              <span>Description</span>
              <span
                className={`shop-item-detail-icon${openPanel === 'description' ? ' is-open' : ''}`}
                aria-hidden="true"
              />
            </summary>

            <div className="shop-item-detail-body" aria-hidden={openPanel !== 'description'}>
              <div className="shop-item-detail-inner">
                {product.description?.heading ? (
                  <h2 className="shop-item-description-heading">{product.description.heading}</h2>
                ) : null}
                {product.description?.paragraphs?.map((paragraph, index) => (
                  <p key={`description-${index}`} className="shop-item-description-copy">
                    {paragraph}
                  </p>
                ))}
                {product.description?.modelNote ? (
                  <p className="shop-item-description-model">{product.description.modelNote}</p>
                ) : null}
              </div>
            </div>
          </details>

          <details className={`shop-item-detail-card${openPanel === 'size-guide' ? ' is-open' : ''}`} open>
            <summary
              className="shop-item-detail-summary"
              onClick={(event) => {
                event.preventDefault();
                handlePanelToggle('size-guide');
              }}
            >
              <span>Size Guide</span>
              <span
                className={`shop-item-detail-icon${openPanel === 'size-guide' ? ' is-open' : ''}`}
                aria-hidden="true"
              />
            </summary>

            <div className="shop-item-detail-body" aria-hidden={openPanel !== 'size-guide'}>
              <div className="shop-item-detail-inner">
                <table className="shop-item-size-guide-table">
                  <thead>
                    <tr>
                      <th aria-hidden="true" />
                      {sizeGuideColumns.map((column) => (
                        <th key={`${product.id}-${column}`} scope="col">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sizeGuideRows.map((rowLabel) => (
                      <tr key={`${product.id}-${rowLabel}`}>
                        <th scope="row">{rowLabel}</th>
                        {sizeGuideColumns.map((column, columnIndex) => (
                          <td key={`${product.id}-${rowLabel}-${column}`}>
                            {product.sizeGuide?.measurements?.[rowLabel]?.[columnIndex] ?? '--'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={sizeGuideColumns.length + 1}>{SIZE_GUIDE_UNITS_LABEL}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </details>
        </article>
      </div>
    </section>
  );
}

export default ShopItem;
