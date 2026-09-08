import { execFileSync } from 'node:child_process';

/**
 * Bring the schema up once, before any integration test runs.
 *
 * The same migrations the app ships and CI verifies — not a hand-maintained
 * test schema, which is how a suite ends up passing against a shape production
 * does not have.
 */
export default function setup() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'Integration tests need DATABASE_URL. Start the local database with\n' +
        '  docker compose up -d db\n' +
        'and run them with\n' +
        '  npm run test:integration',
    );
  }

  // These tests TRUNCATE every table between cases. Refusing anything that is
  // not plainly a local or CI database is the cheap guard against pointing
  // DATABASE_URL at something real and finding out afterwards.
  const host = new URL(databaseUrl).hostname;
  const allowed = ['localhost', '127.0.0.1', '::1', 'db', 'postgres'];

  if (!allowed.includes(host)) {
    throw new Error(
      `Refusing to run destructive integration tests against host "${host}". ` +
        `Allowed: ${allowed.join(', ')}.`,
    );
  }

  execFileSync('npx', ['node-pg-migrate', 'up'], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
}
