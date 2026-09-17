/**
 * Connection options shared by pool.js (the app's long-lived pool) and
 * migrator.js (a one-shot `pg.Client`/node-pg-migrate run) — both have to
 * reach the same database the same way.
 *
 * Discrete params against RDS, or a plain connection string locally.
 * Deliberately never both at once: `pg-connection-string` parses SSL params
 * out of the connection string itself and those override a separately-passed
 * `ssl` option, so a `DATABASE_URL` carrying `?sslmode=require` alongside a
 * `ssl: { ca }` object would silently ignore the CA bundle. Each path sets
 * exactly one of `connectionString` or `ssl`.
 */

const fs = require('fs');
const env = require('../config/env');
const { getDbPassword } = require('./credentials');

const buildConnectionOptions = () => {
  if (!env.DB_SECRET_ARN) {
    return { connectionString: env.DATABASE_URL };
  }

  const caPath = env.DB_SSL_CA_PATH || `${__dirname}/../../certs/rds-global-bundle.pem`;

  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    // A function, not a string: RDS rotates this on its own schedule, and
    // node-postgres calls it again on every new physical connection rather
    // than once at client/pool creation.
    password: getDbPassword,
    ssl: { ca: fs.readFileSync(caPath, 'utf8') },
  };
};

module.exports = buildConnectionOptions;
