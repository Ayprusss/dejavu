import { useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import Navbar from './Components/Navbar/Navbar';
import Footer from './Components/Footer/Footer';
import Cart from './Components/Cart/Cart';
import Entry from './Pages/Entry/Entry';
import Shop from './Pages/Shop/Shop';
import ShopItem from './Pages/ShopItem/ShopItem';
import About from './Pages/About/About';
import Contact from './Pages/Contact/Contact';
import introPhoto from './Pages/Entry/dejavu-intro-photo.webp';
import { getProductById } from './data/products';

const INITIAL_CART_ITEMS = [
  {
    id: 'item-1',
    name: 'Luca Deconstructed Tailored Jacket in Wool & Linen',
    size: 'M',
    price: 850,
    quantity: 1,
    image: introPhoto,
  },
];

const STOCKIST_LINKS = [
  {
    label: 'Addition Adelaide',
    href: 'https://www.instagram.com/additionadelaide/',
  },
  {
    label: 'Adelaide',
    href: 'https://www.instagram.com/adelaidejapan/',
  },
  {
    label: 'Barnes New York Ginza',
    href: 'https://www.instagram.com/barnes_new_york_official/',
  },
  {
    label: 'International Gallery Beams',
    href: 'https://www.instagram.com/international_gallery_beams/',
  },
  {
    label: 'Loftman',
    href: 'https://www.instagram.com/loftmancompany/',
  },
  {
    label: 'Mars',
    href: 'https://www.instagram.com/mars_japan/',
  },
  {
    label: 'United Arrows & Sons',
    href: 'https://www.instagram.com/unitedarrowsandsons/',
  },
  {
    label: '00',
    href: 'https://www.instagram.com/00_store/',
  },
  {
    label: 'Why are you here',
    href: 'https://www.instagram.com/whyareyouhere__/',
  },
  {
    label: 'Ref',
    href: 'https://www.instagram.com/ref_tokyo/',
  },
  {
    label: 'Komune, New York',
    href: 'https://www.instagram.com/komune_ny/',
  },
  {
    label: 'Addicted, Seoul',
    href: 'https://www.instagram.com/addicted_seoul/',
  },
];

function App() {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [cartItems, setCartItems] = useState(INITIAL_CART_ITEMS);
  const location = useLocation();
  const navigate = useNavigate();

  const pathToPage = {
    '/': 'entry',
    '/entry': 'entry',
    '/shop': 'shop',
    '/pages/shop': 'shop',
    '/products': 'shop',
    '/collections': 'collections',
    '/index': 'index',
    '/stockist': 'stockist',
    '/about': 'about',
    '/contact': 'contact',
  };

  const pageToPath = {
    entry: '/entry',
    shop: '/pages/shop#open-shop-submenu',
    collections: '/collections',
    index: '/index',
    stockist: '/stockist',
    about: '/about',
    contact: '/contact',
  };

  const currentPage =
    location.pathname.startsWith('/products/')
      ? 'shop'
      : (pathToPage[location.pathname] ?? 'entry');

  const cartItemCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems],
  );

  const handleIncrement = (itemId) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, quantity: item.quantity + 1 } : item,
      ),
    );
  };

  const handleDecrement = (itemId) => {
    setCartItems((prev) =>
      prev
        .map((item) =>
          item.id === itemId
            ? { ...item, quantity: Math.max(0, item.quantity - 1) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const handleRemove = (itemId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleAddToCart = ({ productId, size }) => {
    const product = getProductById(productId);

    if (!product || !size) {
      return;
    }

    const cartLineId = `${productId}-${size}`;
    setCartItems((prev) => {
      const existingItem = prev.find((item) => item.id === cartLineId);

      if (existingItem) {
        return prev.map((item) =>
          item.id === cartLineId ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      return [
        ...prev,
        {
          id: cartLineId,
          name: product.name,
          size,
          price: Number(product.priceUsd) || 0,
          quantity: 1,
          image: product.images?.[0]?.src ?? introPhoto,
        },
      ];
    });

    setIsCartOpen(true);
  };

  const handleNavigate = (page) => {
    if (page === 'account') {
      setIsAccountOpen((prev) => !prev);
      return;
    }

    setIsAccountOpen(false);
    navigate(pageToPath[page] ?? '/entry');
  };

  return (
    <div className="app-shell">
      <Navbar
        currentPage={currentPage}
        isAccountOpen={isAccountOpen}
        stockistLinks={STOCKIST_LINKS}
        onNavigate={handleNavigate}
      />
      <Cart
        isOpen={isCartOpen}
        itemCount={cartItemCount}
        items={cartItems}
        onOpen={() => setIsCartOpen(true)}
        onClose={() => setIsCartOpen(false)}
        onIncrement={handleIncrement}
        onDecrement={handleDecrement}
        onRemove={handleRemove}
      />
      <Footer />
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/entry" replace />} />
          <Route path="/entry" element={<Entry />} />
          <Route path="/shop" element={<Navigate to="/pages/shop" replace />} />
          <Route path="/pages/shop" element={<Shop />} />
          <Route
            path="/products/:productId"
            element={<ShopItem key={location.pathname} onAddToCart={handleAddToCart} />}
          />
          <Route path="/collections" element={<Entry />} />
          <Route path="/index" element={<Entry />} />
          <Route path="/stockist" element={<Entry />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<Navigate to="/entry" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
