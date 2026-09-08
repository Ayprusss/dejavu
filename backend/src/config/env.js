/**
 * Single source of truth for environment configuration.
 *
 * Reads and validates every variable once, at require-time, and throws listing
 * ALL missing names at once rather than failing one at a time. Nothing else in
 * the codebase should read `process.env` directly.
 *
 * This module deliberately does NOT load dotenv. The npm scripts pass
 * `--require dotenv/config`, and in a container or Lambda there is no `.env`
 * file to find — the variables come from the environment itself.
 */

const REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

const MIN_JWT_SECRET_LENGTH = 32;

const problems = [];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  problems.push(`Missing required environment variables: ${missing.join(', ')}`);
}

// A short secret is as good as no secret: it signs admin tokens.
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
  problems.push(
    `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters (got ${process.env.JWT_SECRET.length})`,
  );
}

const port = Number(process.env.PORT ?? 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  problems.push(
    `PORT must be an integer between 1 and 65535 (got "${process.env.PORT}")`,
  );
}

// One connection per warm Lambda instance in Phase 6, so this has to be tunable
// per environment rather than baked in.
const poolMax = Number(process.env.PG_POOL_MAX ?? 10);
if (!Number.isInteger(poolMax) || poolMax < 1) {
  problems.push(
    `PG_POOL_MAX must be a positive integer (got "${process.env.PG_POOL_MAX}")`,
  );
}

if (problems.length > 0) {
  throw new Error(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
}

const parseList = (value, fallback) => {
  if (!value) return fallback;
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : fallback;
};

module.exports = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: port,

  DATABASE_URL: process.env.DATABASE_URL,
  PG_POOL_MAX: poolMax,

  JWT_SECRET: process.env.JWT_SECRET,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,

  // Used to build Stripe's success/cancel redirect URLs.
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://dejavustudio.xyz',

  CORS_ORIGINS: parseList(process.env.CORS_ORIGINS, [
    'https://dejavustudio.xyz',
    'https://dejavu-ten.vercel.app',
    'http://localhost:5173', // Vite dev server
  ]),
});
