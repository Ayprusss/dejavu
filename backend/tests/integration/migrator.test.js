/**
 * The migrator's `grant-admin` action against a real `User` row.
 *
 * tests/migrator.test.js unit-tests the refusals and the admin.granted log
 * with `db/pool`/`repositories/userRepo`/`lib/logger` stubbed via
 * require.cache — this is the complement: does it actually flip `isAdmin` in
 * Postgres, matched the same case-insensitive way `authController.login`
 * does (migration 0007's `lower(email)` index)?
 */

const { query, resetDatabase, seedUser } = require('./helpers');
const { grantAdmin } = require('../../src/migrator');

beforeEach(async () => {
  await resetDatabase();
});

describe('migrator grant-admin (integration)', () => {
  it('sets isAdmin on the matching row, looked up case-insensitively', async () => {
    const user = await seedUser({ email: 'future-admin@example.com' });

    const result = await grantAdmin('FUTURE-ADMIN@Example.com');

    expect(result).toEqual({
      granted: true,
      alreadyAdmin: false,
      userId: user.id,
    });

    const [row] = await query('SELECT "isAdmin" FROM "User" WHERE "id" = $1', [
      user.id,
    ]);
    expect(row.isAdmin).toBe(true);
  });

  it('succeeds idempotently against a user who is already an admin', async () => {
    const user = await seedUser({ email: 'already-admin@example.com', isAdmin: true });

    const result = await grantAdmin('already-admin@example.com');

    expect(result).toEqual({
      granted: true,
      alreadyAdmin: true,
      userId: user.id,
    });

    const [row] = await query('SELECT "isAdmin" FROM "User" WHERE "id" = $1', [
      user.id,
    ]);
    expect(row.isAdmin).toBe(true);
  });

  it('rejects an email with no matching user, rather than a silent no-op', async () => {
    await expect(grantAdmin('ghost@example.com')).rejects.toThrow(/No registered user/);
  });

  it('leaves other users alone', async () => {
    const target = await seedUser({ email: 'target@example.com' });
    const other = await seedUser({ email: 'other@example.com' });

    await grantAdmin('target@example.com');

    const rows = await query('SELECT "id", "isAdmin" FROM "User" ORDER BY "email"');
    expect(rows.find((r) => r.id === target.id).isAdmin).toBe(true);
    expect(rows.find((r) => r.id === other.id).isAdmin).toBe(false);
  });
});
