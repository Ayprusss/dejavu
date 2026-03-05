import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './Collections.css';
import { COLLECTIONS_META } from '../../data/collectionsMeta';
import collectionsData from '../../data/collectionsData.json';

function Collections({ onActiveCollectionChange }) {
    const { hash } = useLocation();

    useEffect(() => {
        if (hash) {
            // Small delay to ensure images start rendering
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
        if (!onActiveCollectionChange) return;

        const observer = new IntersectionObserver(
            (entries) => {
                let found = null;
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        found = entry.target.id.replace('collection-', '');
                    }
                });

                if (found) {
                    onActiveCollectionChange(found);
                }
            },
            {
                root: null,
                rootMargin: '-20% 0px -60% 0px',
                threshold: 0
            }
        );

        const sections = document.querySelectorAll('.collection-section');
        sections.forEach((section) => observer.observe(section));

        return () => {
            sections.forEach((section) => observer.unobserve(section));
            onActiveCollectionChange(null);
        };
    }, [onActiveCollectionChange]);

    return (
        <div className="collections-page">
            {COLLECTIONS_META.map((meta) => {
                const images = collectionsData[meta.folder] || [];
                return (
                    <section key={meta.id} id={`collection-${meta.id}`} className="collection-section">
                        <h2 className="collection-title">{meta.title}</h2>
                        <div className="collection-images">
                            {images.map((imgName) => (
                                <img
                                    key={imgName}
                                    src={`/Collections/${meta.folder}/${imgName}`}
                                    alt={`${meta.title} look`}
                                    loading="lazy"
                                    className="collection-image"
                                />
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

export default Collections;
