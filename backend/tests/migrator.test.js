const { handler, seed } = require('../src/migrator');

/**
 * The "up" path (real migrations against a real database) is exercised for
 * real in 6.7's first deploy, not here. What's worth a fast unit test is the
 * one guard standing between {"action":"seed"} and a truncate-everything
 * operation reaching prod: tests/setup.js never sets DEPLOY_ENV, so this
 * verifies the refusal is the default, not an opt-in.
 */
describe('migrator handler', () => {
  it('rejects an unsupported action', async () => {
    await expect(handler({ action: 'down' })).rejects.toThrow(/Unsupported action/);
  });

  it('rejects a missing action', async () => {
    await expect(handler({})).rejects.toThrow(/Unsupported action/);
  });

  it('refuses to seed unless DEPLOY_ENV is exactly "dev"', async () => {
    expect(process.env.DEPLOY_ENV).toBeUndefined();
    await expect(seed()).rejects.toThrow(/Refusing to seed/);
  });

  it('routes {"action":"seed"} through the same guard', async () => {
    await expect(handler({ action: 'seed' })).rejects.toThrow(/Refusing to seed/);
  });
});

/**
 * `grant-admin` touches the database (via db/pool and repositories/userRepo)
 * and the logger, both of which transitively require config/env — exactly
 * the module `vi.mock` can't reach here, since it targets ESM `import`, not
 * a plain CommonJS `require` (see tests/dbCredentials.test.js and
 * tests/envDbConfig.test.js). Stubbing require.cache directly is what
 * actually intercepts migrator.js's own `require('./db/pool')` etc., and
 * keeps this a unit test: no real Postgres involved.
 */
describe('migrator grant-admin', () => {
  const poolPath = require.resolve('../src/db/pool');
  const userRepoPath = require.resolve('../src/repositories/userRepo');
  const loggerPath = require.resolve('../src/lib/logger');
  const migratorPath = require.resolve('../src/migrator');

  let findByEmail;
  let setAdminById;
  let loggerInfo;

  const stubModule = (modulePath, exportsValue) => {
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: exportsValue,
    };
  };

  /** Fresh mocks and a fresh require of migrator.js for every test. */
  const loadMigrator = () => {
    findByEmail = vi.fn();
    setAdminById = vi.fn();
    loggerInfo = vi.fn();

    stubModule(poolPath, {});
    stubModule(userRepoPath, { findByEmail, setAdminById });
    stubModule(loggerPath, { info: loggerInfo, error: vi.fn() });

    delete require.cache[migratorPath];
    return require('../src/migrator');
  };

  afterEach(() => {
    delete require.cache[poolPath];
    delete require.cache[userRepoPath];
    delete require.cache[loggerPath];
    delete require.cache[migratorPath];
  });

  it('rejects a missing email', async () => {
    const { grantAdmin } = loadMigrator();
    await expect(grantAdmin(undefined)).rejects.toThrow(/valid "email"/);
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('rejects an empty or malformed email', async () => {
    const { grantAdmin } = loadMigrator();
    await expect(grantAdmin('   ')).rejects.toThrow(/valid "email"/);
    await expect(grantAdmin('not-an-email')).rejects.toThrow(/valid "email"/);
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('rejects an unknown email with an error, not a silent no-op', async () => {
    const { grantAdmin } = loadMigrator();
    findByEmail.mockResolvedValue(null);

    await expect(grantAdmin('ghost@example.com')).rejects.toThrow(/No registered user/);
    expect(setAdminById).not.toHaveBeenCalled();
  });

  it('never puts the email in the refusal message (PII stays out of logs)', async () => {
    const { grantAdmin } = loadMigrator();
    findByEmail.mockResolvedValue(null);

    await expect(grantAdmin('secret-address@example.com')).rejects.toThrow();
    try {
      await grantAdmin('secret-address@example.com');
      throw new Error('expected grantAdmin to reject');
    } catch (error) {
      expect(error.message).not.toContain('secret-address@example.com');
    }
  });

  it('matches the email case-insensitively via userRepo.findByEmail, same as login', async () => {
    const { grantAdmin } = loadMigrator();
    findByEmail.mockResolvedValue({ id: 'user-3', isAdmin: false });
    setAdminById.mockResolvedValue({ id: 'user-3', isAdmin: true });

    await grantAdmin('MixedCase@Example.COM');

    expect(findByEmail).toHaveBeenCalledWith(
      expect.anything(),
      'MixedCase@Example.COM',
    );
  });

  it('grants admin and logs admin.granted with the user id, not the email', async () => {
    const { grantAdmin } = loadMigrator();
    findByEmail.mockResolvedValue({ id: 'user-1', isAdmin: false });
    setAdminById.mockResolvedValue({ id: 'user-1', isAdmin: true });

    const result = await grantAdmin('new@example.com');

    expect(setAdminById).toHaveBeenCalledWith(expect.anything(), 'user-1', true);
    expect(result).toEqual({ granted: true, alreadyAdmin: false, userId: 'user-1' });

    expect(loggerInfo).toHaveBeenCalledTimes(1);
    const [fields] = loggerInfo.mock.calls[0];
    expect(fields).toMatchObject({ event: 'admin.granted', userId: 'user-1' });
    expect(JSON.stringify(fields)).not.toContain('new@example.com');
  });

  it('is idempotent when the user is already an admin', async () => {
    const { grantAdmin } = loadMigrator();
    findByEmail.mockResolvedValue({ id: 'user-2', isAdmin: true });

    const result = await grantAdmin('boss@example.com');

    expect(result).toEqual({ granted: true, alreadyAdmin: true, userId: 'user-2' });
    expect(setAdminById).not.toHaveBeenCalled();
    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it('routes {"action":"grant-admin"} through the handler', async () => {
    const { handler: freshHandler } = loadMigrator();
    findByEmail.mockResolvedValue({ id: 'user-4', isAdmin: false });
    setAdminById.mockResolvedValue({ id: 'user-4', isAdmin: true });

    const result = await freshHandler({
      action: 'grant-admin',
      email: 'user4@example.com',
    });

    expect(result).toEqual({ granted: true, alreadyAdmin: false, userId: 'user-4' });
  });
});
