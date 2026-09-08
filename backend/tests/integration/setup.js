// Per-worker setup for the integration suite.
//
// Unlike tests/setup.js, DATABASE_URL is NOT faked here — these tests talk to a
// real Postgres. Everything else is a deterministic stand-in so no real
// credential is ever needed.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

// The webhook fixtures sign payloads with this, and constructEvent verifies
// against it for real — the signature path is exercised, only the network is not.
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integration_test_secret';

process.env.FRONTEND_URL = 'http://localhost:5173';

// Structured logs are verified in their own right elsewhere; here they would
// just bury the test output.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

if (!process.env.DATABASE_URL) {
  throw new Error('Integration tests need DATABASE_URL (see globalSetup.mjs)');
}

// `src/db/pool.js` is a module singleton, and every test file in this suite
// shares one process (singleFork). Ending the pool in one file's afterAll
// therefore hands the next file a closed pool — which fails as a connection
// error in whichever file happens to run second, and looks nothing like the
// scheduling problem it is. Vitest tears the worker down itself, so the pool is
// deliberately left open here.
