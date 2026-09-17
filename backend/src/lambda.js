/**
 * Entrypoint for the API's Lambda container (the Dockerfile's `api` target
 * runs `node src/lambda.js`; the local/compose path still runs
 * src/server.js directly).
 *
 * Loads secrets into `process.env` from SSM *before* requiring anything that
 * reads them, then hands off to the ordinary Express server.
 *
 * This must not `require('./lib/logger')`, `require('./config/env')`, or
 * anything that transitively pulls those in, before the secrets below are in
 * place — `config/env.js` validates at require-time and throws listing every
 * variable this loader exists to supply. A boot failure here is therefore
 * logged as one plain JSON line to stderr by hand, not through pino.
 */

const { loadSecrets: loadSecretsFromSsm } = require('./lib/loadSecretsFromSsm');

const logBootFailure = (message, err) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      event: 'boot.secrets_failed',
      time: new Date().toISOString(),
      message,
      err: err && { message: err.message, stack: err.stack },
    })}\n`,
  );
};

const logBootSuccess = (durationMs) => {
  process.stdout.write(
    `${JSON.stringify({
      level: 'info',
      event: 'boot.secrets_loaded',
      time: new Date().toISOString(),
      durationMs,
    })}\n`,
  );
};

const loadSecrets = async () => {
  if (!process.env.SSM_PARAMETER_PATH) return;

  const start = Date.now();
  await loadSecretsFromSsm();
  logBootSuccess(Date.now() - start);
};

loadSecrets()
  .then(() => require('./server'))
  .catch((err) => {
    logBootFailure('Failed to load secrets before boot', err);
    process.exit(1);
  });
