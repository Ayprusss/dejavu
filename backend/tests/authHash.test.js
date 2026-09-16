const bcrypt = require('bcryptjs');
const { NATIVE_BCRYPT_HASH_OF_PASSWORD123 } = require('./fixtures/bcryptHashes');

/**
 * bcryptjs is a pure-JS reimplementation of the same algorithm, not a wrapper
 * around native bcrypt. A hash produced by every existing User row must still
 * verify after the swap, so this checks it against a hash the native library
 * actually produced rather than assuming compatibility.
 */
describe('bcryptjs compatibility with existing bcrypt hashes', () => {
  it('accepts a hash produced by native bcrypt', async () => {
    const matches = await bcrypt.compare(
      'password123',
      NATIVE_BCRYPT_HASH_OF_PASSWORD123,
    );
    expect(matches).toBe(true);
  });

  it('rejects the wrong password against that same hash', async () => {
    const matches = await bcrypt.compare(
      'wrong-password',
      NATIVE_BCRYPT_HASH_OF_PASSWORD123,
    );
    expect(matches).toBe(false);
  });
});
