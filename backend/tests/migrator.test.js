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
