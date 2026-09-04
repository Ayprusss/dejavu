// src/config/env.js validates at require-time and throws on anything missing.
// Tests get deterministic fake values so no real credential is ever needed.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'test-service-role-key';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy';
process.env.FRONTEND_URL = 'http://localhost:5173';
