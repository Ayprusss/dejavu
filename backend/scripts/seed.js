/**
 * CLI entrypoint for the local dev database:
 *
 *   docker compose up -d db && npm run migrate:up && npm run seed
 *
 * The actual seed logic lives in src/seed.js, shared with the migrator
 * Lambda's `{"action":"seed"}` (scripts/ is dockerignored from that image, so
 * anything it needs has to live under src/).
 */

const pool = require('../src/db/pool');
const seed = require('../src/seed');

seed()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
