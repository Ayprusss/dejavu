/**
 * A hash produced by native `bcrypt` (v6, cost 10) before it was replaced by
 * `bcryptjs` for Phase 6 (Lambda's CPU architecture makes a native build
 * portable only to the exact image it was built in). Both libraries implement
 * the same algorithm, but that claim is worth testing rather than assuming —
 * see tests/authHash.test.js.
 *
 * Generated with:
 *   node -e "require('bcrypt').hash('password123', 10).then(console.log)"
 */
const NATIVE_BCRYPT_HASH_OF_PASSWORD123 =
  '$2b$10$J8jg0nz5m36uuLhTyfWpLOwTTMb/2PPyQ.Wa8zdfc9V1mbWKmcmay';

module.exports = { NATIVE_BCRYPT_HASH_OF_PASSWORD123 };
