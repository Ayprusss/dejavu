/**
 * The migrator Lambda handler — not behind the Lambda Web Adapter, since this
 * is a plain Lambda invocation, not an HTTP endpoint:
 *
 *   aws lambda invoke --function-name dejavu-dev-migrator \
 *     --payload '{"action":"up"}' --cli-binary-format raw-in-base64-out out.json
 *
 * RDS is private (no route from a laptop by design), so this is the only way
 * to run migrations or seed a deployed environment.
 *
 * node-pg-migrate 9 is ESM-only (`"type": "module"` in its own package.json)
 * while this backend is CommonJS, so it has to be loaded with a dynamic
 * `import()` rather than `require()`.
 *
 * Unlike the api target, this handler isn't run through lambda.js, so it has
 * to load SSM secrets itself — and, same reasoning as lambda.js, it must not
 * require('./config/env') or anything that transitively requires it
 * (./db/connectionOptions does) until after that load, since env.js
 * validates at require-time. Found by actually invoking this against a real
 * deployment in 6.7: the handler threw "Missing required environment
 * variables" on every action because nothing had loaded them yet.
 */

const path = require('path');
const { loadSecrets } = require('./lib/loadSecretsFromSsm');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Matches node-pg-migrate's own default (and what the CLI scripts in
// package.json use unconfigured), so `npm run migrate:up` locally and this
// handler against RDS read and write the same migration history table.
const MIGRATIONS_TABLE = 'pgmigrations';

/**
 * Runs every pending migration in migrations/.
 *
 * node-pg-migrate takes a Postgres advisory lock (a fixed, well-known id, for
 * the duration of the run), so two concurrent invocations of this handler
 * can't race. The lock mode isn't set, and 9.0.0's default is 'fail': the
 * second invocation throws "Another migration is already running" at once
 * rather than waiting, and runs nothing. migrate.sh sees that as a
 * FunctionError. The shared deploy concurrency group keeps it from happening
 * in CI.
 */
const up = async () => {
  const buildConnectionOptions = require('./db/connectionOptions');
  const { runner } = await import('node-pg-migrate');

  const applied = await runner({
    databaseUrl: buildConnectionOptions(),
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    direction: 'up',
    log: (msg) => console.log(msg),
  });

  return applied.map((migration) => migration.name);
};

/**
 * Truncates every table and inserts fixtures — see src/seed.js. Gated to
 * DEPLOY_ENV === 'dev': that check is the only thing standing between this
 * and running against prod, since a payload alone can't be trusted.
 */
const seed = async () => {
  const env = require('./config/env');

  if (env.DEPLOY_ENV !== 'dev') {
    throw new Error(
      `Refusing to seed: DEPLOY_ENV is ${JSON.stringify(env.DEPLOY_ENV)}, not "dev".`,
    );
  }

  const runSeed = require('./seed');
  await runSeed();
  return { seeded: true };
};

/** Loose sanity check, not full RFC validation — just enough to catch a typo'd payload. */
const looksLikeEmail = (value) =>
  typeof value === 'string' && /^\S+@\S+$/.test(value.trim());

/**
 * Sets `isAdmin = true` on an already-registered user. Unlike `seed`, this is
 * allowed in every DEPLOY_ENV: it writes one row a human named by email,
 * rather than truncating the database, so there is nothing here for prod to
 * be protected from.
 *
 * Matches the email the same case-insensitive way `authController.login`
 * does — `userRepo.findByEmail` compares on `lower(email)`, lining up with
 * the unique index from migration 0007.
 *
 * Refuses on a missing/malformed email and on an email with no matching
 * user — both are errors, not a silent no-op, so a typo doesn't look like it
 * worked. Granting a user who is already an admin succeeds idempotently
 * instead of erroring, so re-running this (or two people running it) is safe.
 *
 * Deferred requires, same reasoning as `up`/`seed`: `db/pool` and `lib/logger`
 * both transitively require `config/env`, which validates at require-time and
 * must not run before `loadSecrets()` has populated `process.env`.
 */
const grantAdmin = async (email) => {
  if (!looksLikeEmail(email)) {
    throw new Error(`grant-admin requires a valid "email" string.`);
  }

  const pool = require('./db/pool');
  const userRepo = require('./repositories/userRepo');
  const logger = require('./lib/logger');

  const user = await userRepo.findByEmail(pool, email.trim());
  if (!user) {
    // No email here, deliberately — this error can surface in an invocation
    // result or a CI log, and the email is exactly the PII admin.granted
    // below is careful to leave out.
    throw new Error('No registered user found for that email.');
  }

  if (user.isAdmin) {
    return { granted: true, alreadyAdmin: true, userId: user.id };
  }

  await userRepo.setAdminById(pool, user.id, true);

  // userId only, never the email — keeps PII out of CloudWatch.
  logger.info({ event: 'admin.granted', userId: user.id }, 'Granted admin access');

  return { granted: true, alreadyAdmin: false, userId: user.id };
};

exports.up = up;
exports.seed = seed;
exports.grantAdmin = grantAdmin;

exports.handler = async (event) => {
  await loadSecrets();

  const action = event?.action;

  if (action === 'up') {
    return { migrations: await up() };
  }

  if (action === 'seed') {
    return seed();
  }

  if (action === 'grant-admin') {
    return grantAdmin(event?.email);
  }

  throw new Error(
    `Unsupported action ${JSON.stringify(action)}. Only "up", "seed" and ` +
      '"grant-admin" are accepted — "down" against a deployed database is ' +
      'deliberately not a payload.',
  );
};
