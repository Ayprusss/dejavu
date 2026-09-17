/**
 * The password half of RDS's managed master-user secret, cached briefly.
 *
 * `manage_master_user_password = true` (Terraform, Phase 6) means RDS creates
 * and rotates this secret itself, on its own 7-day schedule — the password
 * never enters Terraform state. node-postgres accepts `password` as an async
 * function rather than a string precisely for credentials like this: it is
 * called again on every new physical connection, so a rotation is picked up
 * the next time the pool opens a fresh connection rather than requiring a
 * redeploy.
 *
 * The cache exists only to bound how often a warm Lambda calls Secrets
 * Manager — it is short enough that a rotation landing mid-cache is still
 * covered by pool.js invalidating it on a 28P01 (auth failed) error.
 */

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const env = require('../config/env');

const CACHE_TTL_MS = 5 * 60 * 1000;

let client;
let cached = null; // { password, fetchedAt }

const getClient = () => {
  if (!client) client = new SecretsManagerClient({});
  return client;
};

const getDbPassword = async () => {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.password;
  }

  const response = await getClient().send(
    new GetSecretValueCommand({ SecretId: env.DB_SECRET_ARN }),
  );
  const { password } = JSON.parse(response.SecretString);

  cached = { password, fetchedAt: Date.now() };
  return password;
};

/** Forces the next `getDbPassword()` call to re-fetch instead of using the cache. */
const invalidate = () => {
  cached = null;
};

module.exports = { getDbPassword, invalidate };
