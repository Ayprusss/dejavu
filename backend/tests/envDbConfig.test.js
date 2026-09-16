// config/env.js validates at require-time, so each case needs a fresh module
// instance to see the effect of a different process.env shape. `vi.mock`/
// `vi.resetModules` target vitest's ESM module graph, which a plain CommonJS
// `require` never goes through — so the cache has to be busted directly.
const ORIGINAL_ENV = { ...process.env };
const envModulePath = require.resolve('../src/config/env');

const loadEnv = () => {
  delete require.cache[envModulePath];
  return require('../src/config/env');
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('config/env database configuration', () => {
  it('accepts DATABASE_URL alone — the local/CI/test path, unchanged', () => {
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_SECRET_ARN;

    expect(() => loadEnv()).not.toThrow();
  });

  it('accepts a complete discrete config with no DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    process.env.DB_HOST = 'db.example.com';
    process.env.DB_NAME = 'dejavu';
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:x';

    expect(() => loadEnv()).not.toThrow();
  });

  it('rejects a partial discrete config even when DATABASE_URL is also set', () => {
    // DATABASE_URL is left as tests/setup.js set it — an incomplete DB_HOST/
    // DB_NAME/DB_SECRET_ARN set must fail boot regardless, so a Lambda that
    // forgets one of the three never falls back to a wrong assumption.
    process.env.DB_HOST = 'db.example.com';
    delete process.env.DB_NAME;
    delete process.env.DB_SECRET_ARN;

    expect(() => loadEnv()).toThrow(/Incomplete discrete database config/);
  });

  it('rejects neither DATABASE_URL nor any discrete var being set', () => {
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_SECRET_ARN;

    expect(() => loadEnv()).toThrow(/Database configuration missing/);
  });
});
