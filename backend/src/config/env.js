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

const REQUIRED = ['JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];

const MIN_JWT_SECRET_LENGTH = 32;

const problems = [];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  problems.push(`Missing required environment variables: ${missing.join(', ')}`);
}

/**
 * The database can be reached either way: a single `DATABASE_URL` (local,
 * CI, tests) or three discrete Lambda-friendly parts, because RDS is private
 * and the password comes from Secrets Manager rather than a connection
 * string. A *partial* discrete set (say, `DB_HOST` and `DB_NAME` but a
 * forgotten `DB_SECRET_ARN`) is worse than neither being set — pool.js would
 * silently build a connection missing a piece — so that fails boot too.
 */
const DB_DISCRETE_VARS = ['DB_HOST', 'DB_NAME', 'DB_SECRET_ARN'];
const presentDbVars = DB_DISCRETE_VARS.filter((name) => process.env[name]);
const hasDiscreteDbConfig = presentDbVars.length === DB_DISCRETE_VARS.length;

if (presentDbVars.length > 0 && !hasDiscreteDbConfig) {
  const missingDbVars = DB_DISCRETE_VARS.filter((name) => !process.env[name]);
  problems.push(
    `Incomplete discrete database config: set all of ${DB_DISCRETE_VARS.join(', ')} (missing: ${missingDbVars.join(', ')})`,
  );
} else if (presentDbVars.length === 0 && !process.env.DATABASE_URL) {
  problems.push(
    `Database configuration missing: set DATABASE_URL, or all of ${DB_DISCRETE_VARS.join(', ')}`,
  );
}

const dbPort = Number(process.env.DB_PORT ?? 5432);
if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
  problems.push(`DB_PORT must be an integer between 1 and 65535 (got "${process.env.DB_PORT}")`);
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

const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
if (!Number.isInteger(trustProxy) || trustProxy < 0) {
  problems.push(
    `TRUST_PROXY must be a non-negative integer (got "${process.env.TRUST_PROXY}")`,
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
  DB_HOST: process.env.DB_HOST,
  DB_PORT: dbPort,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_SECRET_ARN: process.env.DB_SECRET_ARN,
  DB_SSL_CA_PATH: process.env.DB_SSL_CA_PATH,
  PG_POOL_MAX: poolMax,

  LOG_LEVEL:
    process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),

  // Number of proxies in front of the app. Express uses this to decide which
  // entry in X-Forwarded-For is the real client — which is what the rate
  // limiter keys on, so a wrong value here lets one client be counted as many.
  // 0 (the default) means no proxy and the socket address is used directly.
  TRUST_PROXY: trustProxy,

  JWT_SECRET: process.env.JWT_SECRET,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,

  // Used to build Stripe's success/cancel redirect URLs.
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://dejavustudio.xyz',

  // Set by the CI image build (--build-arg GIT_SHA=$(git rev-parse HEAD)) and
  // surfaced at GET /api/version, so a smoke test can confirm the SHA it just
  // deployed is the one actually live.
  GIT_SHA: process.env.GIT_SHA || 'unknown',

  // Set by Terraform on the migrator Lambda only ('dev' or 'prod'). Guards
  // migrator.js's {"action":"seed"} — a truncate-everything operation that
  // must never run against prod. Unset locally; the CLI seed script
  // (npm run seed) isn't gated by this, since running it is already a
  // deliberate act against whatever DATABASE_URL you pointed it at.
  DEPLOY_ENV: process.env.DEPLOY_ENV,

  CORS_ORIGINS: parseList(process.env.CORS_ORIGINS, [
    'https://dejavustudio.xyz',
    'https://dejavu-ten.vercel.app',
    'http://localhost:5173', // Vite dev server
  ]),
});
