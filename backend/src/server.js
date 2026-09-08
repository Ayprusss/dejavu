const app = require('./app');
const pool = require('./db/pool');
const logger = require('./lib/logger');
const env = require('./config/env');

const server = app.listen(env.PORT, () => {
  logger.info({ event: 'server.started', port: env.PORT }, 'Server listening');
});

/**
 * Shut down without dropping work in flight.
 *
 * A container orchestrator sends SIGTERM and then waits a grace period before
 * SIGKILL. Exiting immediately aborts every request currently being served and
 * abandons pooled connections mid-statement; the database only notices when the
 * TCP connection times out. So: stop accepting new connections, let the open
 * ones finish, then drain the pool.
 *
 * The timer is the backstop. If a request hangs, the grace period gets spent
 * waiting and SIGKILL arrives anyway — better to give up first and exit for a
 * reason we can see in the logs.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ event: 'server.shutdown_started', signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error(
      { event: 'server.shutdown_timeout', timeoutMs: SHUTDOWN_TIMEOUT_MS },
      'Graceful shutdown timed out, exiting',
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Not referenced by anything else, so it must not hold the loop open itself.
  forceExit.unref();

  server.close(async (closeError) => {
    if (closeError) {
      logger.error(
        { event: 'server.close_failed', err: closeError },
        'Server close failed',
      );
    }

    try {
      await pool.end();
      logger.info({ event: 'server.shutdown_complete' }, 'Shutdown complete');
      process.exit(closeError ? 1 : 0);
    } catch (poolError) {
      logger.error(
        { event: 'server.pool_drain_failed', err: poolError },
        'Pool drain failed',
      );
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
