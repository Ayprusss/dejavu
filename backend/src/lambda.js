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

const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');

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

/**
 * Copies every parameter under `path` into `process.env`, without
 * overwriting a variable that's already set (Lambda env vars set directly by
 * Terraform, e.g. DB_HOST, take precedence over anything with the same name
 * under the SSM path).
 */
const loadSsmParameters = async (path) => {
  const ssm = new SSMClient({});
  let nextToken;

  do {
    const response = await ssm.send(
      new GetParametersByPathCommand({
        Path: path,
        WithDecryption: true,
        // Flat by design: everything this app needs lives directly under
        // /dejavu/<env>/, one level deep.
        Recursive: false,
        NextToken: nextToken,
      }),
    );

    for (const param of response.Parameters ?? []) {
      const name = param.Name.slice(path.length).replace(/^\//, '');
      if (process.env[name] === undefined) {
        process.env[name] = param.Value;
      }
    }

    nextToken = response.NextToken;
  } while (nextToken);
};

/**
 * The RDS-managed secret carries `{ username, password }`. The password is
 * fetched lazily per-connection by db/credentials.js because it rotates; the
 * username doesn't, so it's safe — and necessary, pool.js has nowhere else to
 * get it — to read once here into DB_USER.
 */
const loadDbUsername = async () => {
  if (!process.env.DB_SECRET_ARN || process.env.DB_USER !== undefined) return;

  const secretsManager = new SecretsManagerClient({});
  const response = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }),
  );
  const { username } = JSON.parse(response.SecretString);
  process.env.DB_USER = username;
};

const loadSecrets = async () => {
  const path = process.env.SSM_PARAMETER_PATH;
  if (!path) return;

  const start = Date.now();
  await loadSsmParameters(path);
  await loadDbUsername();
  logBootSuccess(Date.now() - start);
};

loadSecrets()
  .then(() => require('./server'))
  .catch((err) => {
    logBootFailure('Failed to load secrets before boot', err);
    process.exit(1);
  });
