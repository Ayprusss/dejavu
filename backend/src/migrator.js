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
 * serialise against each other rather than racing — the second simply waits
 * for the lock rather than running anything twice.
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

exports.up = up;
exports.seed = seed;

exports.handler = async (event) => {
  await loadSecrets();

  const action = event?.action;

  if (action === 'up') {
    return { migrations: await up() };
  }

  if (action === 'seed') {
    return seed();
  }

  throw new Error(
    `Unsupported action ${JSON.stringify(action)}. Only "up" and "seed" are accepted — ` +
      '"down" against a deployed database is deliberately not a payload.',
  );
};
