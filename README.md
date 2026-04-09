# Dejavu

Dejavu is a full-featured webstore project created to act as a functional mock of the brand "Vuja-de". It is an end-to-end e-commerce application that provides a seamless luxury shopping experience for users while offering comprehensive tools for administrators.

## 🎯 Goal
To design and build a fully functional, high-quality webstore mock of **vuja-de**, demonstrating modern web development practices, extensive e-commerce workflows, dynamic interface design, and seamless payment integrations.

## ✨ Features

- **Storefront & Navigation**
  - Dynamic Index page with scroll-anchored image navigation to replicate high-end brand landing pages.
  - Dedicated pages for Shop, Collections, and individual Items with a responsive aesthetic.
- **Authentication & User Accounts**
  - Secure user registration and login flows heavily secured via bcrypt and JWT authentication.
  - Account registration intelligently links past guest orders to new user profiles based on checkout emails.
- **Checkout & Global Payments**
  - Secure payment processing integrated natively with Stripe Checkout.
  - Robust backend webhook listeners to securely confirm and record transparent checkout events without spoofing risk.
- **Administrator Panel**
  - Dedicated admin dashboard implementing role-based access control (RBAC).
  - Tools mapping endpoints to manage product inventory, view incoming orders, and inspect user activity.
- **Contact Capabilities**
  - Functional contact forms leveraging direct EmailJS API integration for streamlined customer-to-admin communications.

## 💻 Tech Stack

### Frontend
- **React (v19)** - Core rendering library for building scalable user interfaces.
- **Vite** - High-performance modern frontend build tooling.
- **React Router DOM** - Application routing and state management synchronization.
- **Vanilla CSS** - Focused, flexible, and dynamic component-based styling to ensure top-notch performance.
- **EmailJS** - Integrated client-side email delivery.

### Backend
- **Node.js & Express.js** - Robust runtime environment processing REST API routes securely.
- **Supabase / PostgreSQL** - Cloud-hosted functional relational database managing robust entity relationships.
- **Stripe SDK** - Enterprise-grade payment gateway management toolkit.
- **JWT & bcrypt** - Industry-standard authorization flows and data encryption for secure API utilization.

## 🏗️ Architecture

The application implements a decoupled, modern Client-Server App architecture pattern:

* **Client-side (Frontend SPA)**: A high-performance Single Page Application driven by React and Vite. It oversees browser history, handles visual states, manages user flows asynchronously, and connects securely to the backend's REST layer for data fetching and mutations.
* **Server-side (Backend REST API)**: An Express Node.js backend architected with a monolithic modular pattern. Handlers are securely encapsulated in distinct controllers (`authController.js`, `checkoutController.js`, `adminController.js`, `productController.js`, `webhookController.js`) separating specific domain responsibilities.
* **Database Layer**: Supabase serves as a persistent relational database (PostgreSQL), heavily tracking structural product data, active inventory metrics, user profiles, and completed transactions.
* **Webhooks & External Service Integration**: Core transactional elements are offloaded to specialized external providers. Stripe isolates customer payment credentials in its sandbox, only returning asynchronous completion events directly verified by the server's webhook controller.
