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
import Admin from './Pages/Admin/Admin';
import Account from './Pages/Account/Account';
import CheckoutSuccess from './Pages/Checkout/CheckoutSuccess';
import CheckoutCancel from './Pages/Checkout/CheckoutCancel';
import introPhoto from './Pages/Entry/dejavu-intro-photo.webp';
import Collections from './Pages/Collections/Collections';
import IndexPage from './Pages/Index/Index';
import { COLLECTIONS_META } from './data/collectionsMeta';

const INITIAL_CART_ITEMS = [];

const STOCKIST_LINKS = [
  {
    label: 'Addition Adelaide',
    href: 'https://www.instagram.com/additionadelaide?igsh=OGRlZGR1dmd0cXVw',
  },
  {
    label: 'Adelaide',
    href: 'https://www.instagram.com/selectshop_adelaide?igsh=c3d3dWx0OWh5eHp3',
  },
  {
    label: 'Barnes New York Ginza',
    href: 'https://www.instagram.com/barneysnewyork_ginza?igsh=MWFkZzB3d202bmVoZA%3D%3D',
  },
  {
    label: 'International Gallery Beams',
    href: 'https://www.instagram.com/international_gallery_beams?igsh=ejhydjN2eWQ5ZDk1',
  },
  {
    label: 'Loftman',
    href: 'https://www.instagram.com/loftmancompany/',
  },
  {
    label: 'Mars',
    href: 'https://www.instagram.com/latest_on_mars/',
  },
  {
    label: 'United Arrows & Sons',
    href: 'https://www.instagram.com/unitedarrowsandsons?igsh=ZGlydWJxMDc5aThu',
  },
  {
    label: '00',
    href: 'https://www.instagram.com/00_zerozero_?igsh=c21pejVnN2diZmZs',
  },
  {
    label: 'Why are you here',
    href: 'https://www.instagram.com/whyareyouhere_osaka?igsh=MTk0bnIwYjhramRn',
  },
  {
    label: 'Ref.',
    href: 'https://www.instagram.com/ref.store_?igsh=cGVuampudmE1eTBt',
  },
  {
    label: 'Komune, New York',
    href: 'https://www.instagram.com/komune.space/',
  },
  {
    label: 'Addicted, Seoul',
    href: 'https://www.instagram.com/addictedseoul/',
  },
];

function App() {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [cartItems, setCartItems] = useState(INITIAL_CART_ITEMS);
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [activeIndexId, setActiveIndexId] = useState(null);
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
    admin: '/admin',
    account: '/account',
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

  const handleAddToCart = (productPayload) => {
    if (!productPayload || !productPayload.size) {
      return;
    }

    const cartLineId = productPayload.variantId || `${productPayload.productId}-${productPayload.size}`;
    
    setCartItems((prev) => {
      const existingItem = prev.find((item) => item.id === cartLineId);

      if (existingItem) {
        return prev.map((item) =>
          item.id === cartLineId ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      // Convert priceLabel string back into a number for Cart subtotal calculation
      const numericPrice = typeof productPayload.price === 'string' 
        ? Number(productPayload.price.replace(/[^0-9.-]+/g,"")) 
        : Number(productPayload.price) || 0;

      return [
        ...prev,
        {
          id: cartLineId,
          variantId: productPayload.variantId,
          stripePriceId: productPayload.stripePriceId,
          name: productPayload.name,
          size: productPayload.size,
          price: numericPrice,
          quantity: 1,
          image: productPayload.image || introPhoto,
        },
      ];
    });

    setIsCartOpen(true);
  };

  const handleNavigate = (page, hash = '') => {
    if (page === 'account') {
      setIsAccountOpen((prev) => !prev);
      return;
    }

    setIsAccountOpen(false);
    navigate((pageToPath[page] ?? '/entry') + hash);
  };

  const isAppRoute = !location.pathname.startsWith('/admin') && !location.pathname.startsWith('/account');

  return (
    <div className="app-shell">
      {isAppRoute && (
        <Navbar
          currentPage={currentPage}
          isAccountOpen={isAccountOpen}
          stockistLinks={STOCKIST_LINKS}
          collectionsLinks={COLLECTIONS_META}
          activeCollectionId={activeCollectionId}
          activeIndexId={activeIndexId}
          onNavigate={handleNavigate}
          cartItemCount={cartItemCount}
          onOpenCart={() => setIsCartOpen(true)}
        />
      )}
      
      {isAppRoute && (
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
      )}
      
      <main className={isAppRoute ? "app-content" : ""}>
        <Routes>
          <Route path="/" element={<Navigate to="/entry" replace />} />
          <Route path="/entry" element={<Entry />} />
          <Route path="/shop" element={<Navigate to="/pages/shop" replace />} />
          <Route path="/pages/shop" element={<Shop />} />
          <Route
            path="/products/:productId"
            element={<ShopItem key={location.pathname} onAddToCart={handleAddToCart} />}
          />
          <Route path="/collections" element={<Collections onActiveCollectionChange={setActiveCollectionId} />} />
          <Route path="/index" element={<IndexPage onActiveIndexChange={setActiveIndexId} />} />
          <Route path="/stockist" element={<Entry />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/checkout/cancel" element={<CheckoutCancel />} />
          
          <Route path="/admin/*" element={<Admin />} />
          <Route path="/account/*" element={<Account />} />
          
          <Route path="*" element={<Navigate to="/entry" replace />} />
        </Routes>
      </main>

      {isAppRoute && <Footer />}
    </div>
  );
}

export default App;
