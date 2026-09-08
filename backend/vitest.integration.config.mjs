import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Express app, real Postgres, no mocked data layer.
 *
 * Kept in a separate project from the unit suite so `npm test` stays fast and
 * needs no database — the unit tests cover pure logic and should be runnable on
 * a laptop with nothing running.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    globalSetup: ['./tests/integration/globalSetup.mjs'],
    setupFiles: ['./tests/integration/setup.js'],

    // One process, one test at a time, against one database.
    //
    // Isolation is `TRUNCATE` between tests, which is only sound if nothing
    // else is writing concurrently. Parallel workers would need a schema or a
    // database each — worth it for a large suite, pure overhead for this one.
    // The concurrency these tests exercise is inside a single test.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,

    // A hung transaction should fail the test, not the run.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
