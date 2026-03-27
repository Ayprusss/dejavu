# Dejavu Webstore

Dejavu is a full-stack e-commerce web application designed to provide a premium, modern shopping experience. It features dynamic product showcasing, interactive lookbooks, secure checkout processing, and comprehensive user account management.

## 🚀 Tech Stack

- **Frontend:** React.js, Vite, React Router, custom CSS for responsive design.
- **Backend Infrastructure:** Node.js/Express (hosted on Render), Vercel (Frontend hosting).
- **Database:** Supabase for user accounts, product inventory, and order records.
- **Payments:** Stripe Checkout & Webhooks.
- **Email Services:** EmailJS for contact form submissions.

## ✨ Features

### E-Commerce & Shopping
- **Dynamic Shop Directory:** A fully functional shop interface (`/shop`) to explore products.
- **Product Details:** Individual product pages (`/products/:id`) handling variant selections, sizing, and stock verification.
- **Slide-out Cart:** A responsive shopping cart component allowing users to review items, adjust quantities, and remove items dynamically.
- **Stripe Checkout:** Secure payment sessions via Stripe, with webhook integrations that guarantee order fulfillment, record creation in Supabase, and automatic inventory deduction.

### User Accounts & Authentication
- **User Profiles:** Secure registration and login flows.
- **Order History & Guest Bridging:** Users can log in to view past orders. The system can connect past guest-checkout orders to newly created user profiles based on email addresses.
- **Admin Dashboard:** A secured, consolidated admin interface that seamlessly integrates into the account section for users with administrative privileges, enabling store management.

### Brand Experience & Navigational Interfaces
- **Visual Lookbooks:** `Collections` and `Index` pages featuring dynamic, immersive photography displays, including scroll-anchored image navigation to highlight seasonal releases.
- **Stockists Directory:** Integrated stockist links to showcase global retail partners.
- **Legal & Information:** Built-in modal dialogs for Shipping policies and Terms of Service.

### Interactive Components
- **Contact Form:** Integrated with EmailJS, enabling direct and identifiable inquiries straight from the application front-end.
- **Global Navigation:** A fixed, responsive Navbar and Footer architecture for seamless routing across the webstore.

## 🛠️ Local Development Setup

To run the frontend locally:

1. Clone the repository.
2. Ensure you have Node.js installed.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the Vite development server:
   ```bash
   npm run dev
   ```
5. Navigate to `http://localhost:5173` (or the port specified by Vite) in your browser.

*Note: For full e-commerce functionality, ensure that the appropriate environment variables for Supabase, Stripe, and your backend API URL are configured.*
