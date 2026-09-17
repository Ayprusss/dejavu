// The discrete DB path (see config/env.js) requires all three of these, or
// credentials.js's own `require('../config/env')` throws before this file's
// tests ever run.
process.env.DB_HOST = 'db.example.com';
process.env.DB_NAME = 'dejavu';
process.env.DB_SECRET_ARN =
  'arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-test-abc123';

/**
 * `vi.mock` intercepts ESM `import`, not CommonJS `require` — and this
 * backend, credentials.js included, is CommonJS throughout. Stubbing
 * `require.cache` directly is the mechanism that actually reaches a plain
 * `require('@aws-sdk/client-secrets-manager')` inside credentials.js.
 */
const sdkPath = require.resolve('@aws-sdk/client-secrets-manager');
const send = vi.fn();
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: {
    SecretsManagerClient: vi.fn(() => ({ send })),
    GetSecretValueCommand: vi.fn((input) => input),
  },
};

const { getDbPassword, invalidate } = require('../src/db/credentials');

const secretString = (password) => JSON.stringify({ username: 'postgres', password });

describe('db/credentials getDbPassword', () => {
  beforeEach(() => {
    send.mockClear();
    invalidate();
  });

  it('fetches the password from the RDS-managed secret', async () => {
    send.mockResolvedValueOnce({ SecretString: secretString('pw1') });

    await expect(getDbPassword()).resolves.toBe('pw1');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('caches the password so a call within the TTL does not refetch', async () => {
    send.mockResolvedValue({ SecretString: secretString('pw1') });

    await getDbPassword();
    await getDbPassword();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces the next call to refetch, picking up a rotated password', async () => {
    send.mockResolvedValueOnce({ SecretString: secretString('pw1') });
    await expect(getDbPassword()).resolves.toBe('pw1');

    invalidate();

    send.mockResolvedValueOnce({ SecretString: secretString('pw2') });
    await expect(getDbPassword()).resolves.toBe('pw2');

    expect(send).toHaveBeenCalledTimes(2);
  });
});
