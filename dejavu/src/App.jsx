import { useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import Navbar from './Components/Navbar/Navbar';
import Footer from './Components/Footer/Footer';
import Cart from './Components/Cart/Cart';
import Entry from './Pages/Entry/Entry';
import About from './Pages/About/About';
import Contact from './Pages/Contact/Contact';
import introPhoto from './Pages/Entry/dejavu-intro-photo.webp';

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

function App() {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState(INITIAL_CART_ITEMS);
  const location = useLocation();
  const navigate = useNavigate();

  const pathToPage = {
    '/': 'shop',
    '/shop': 'shop',
    '/collections': 'collections',
    '/index': 'index',
    '/stockist': 'stockist',
    '/about': 'about',
    '/contact': 'contact',
    '/account': 'account',
  };

  const pageToPath = {
    shop: '/shop',
    collections: '/collections',
    index: '/index',
    stockist: '/stockist',
    about: '/about',
    contact: '/contact',
    account: '/account',
  };

  const currentPage = pathToPage[location.pathname] ?? 'shop';

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

  const handleNavigate = (page) => {
    navigate(pageToPath[page] ?? '/shop');
  };

  return (
    <div className="app-shell">
      <Navbar currentPage={currentPage} onNavigate={handleNavigate} />
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
          <Route path="/" element={<Navigate to="/shop" replace />} />
          <Route path="/shop" element={<Entry />} />
          <Route path="/collections" element={<Entry />} />
          <Route path="/index" element={<Entry />} />
          <Route path="/stockist" element={<Entry />} />
          <Route path="/account" element={<Entry />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<Navigate to="/shop" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
