/**
 * The application logger.
 *
 * JSON on one line per event, because the destination is CloudWatch (Phase 6)
 * and the alarms in Phase 7 are metric filters over these fields — a metric
 * filter can match `{ $.event = "checkout.oversell" }` but cannot parse an
 * interpolated English sentence.
 *
 * Every deliberate, alertable event carries an `event` key with a stable dotted
 * name. Those names are an interface: the alarms match on them, so renaming one
 * silently breaks an alarm.
 */

const pino = require('pino');
const env = require('./../config/env');

/**
 * Serialise errors to the fields that identify them, and nothing else.
 *
 * pino's default walks an error's own enumerable properties, which is fine for
 * `new Error(...)` and ruinous for driver errors: node-postgres attaches the
 * whole `Client` to a DatabaseError, so one connection blip logged several
 * kilobytes of connection internals and type tables on a single line. At
 * CloudWatch's per-GB ingest that is a bill, and it buries the one field
 * anybody reads.
 *
 * Everything kept below is something a person or an alarm acts on. `code` and
 * `constraint` in particular are how a Postgres error is identified — 23514 is
 * the stock CHECK, 23505 a unique violation.
 */
const serializeError = (err) => {
  if (!err || typeof err !== 'object') return err;

  return {
    type: err.name ?? err.constructor?.name,
    message: err.message,
    stack: err.stack,
    ...(err.code !== undefined && { code: err.code }),
    ...(err.constraint !== undefined && { constraint: err.constraint }),
    ...(err.detail !== undefined && { detail: err.detail }),
    ...(err.severity !== undefined && { severity: err.severity }),
    ...(err.status !== undefined && { status: err.status }),
  };
};

const logger = pino({
  level: env.LOG_LEVEL,

  serializers: { err: serializeError },

  // Pretty output would need pino-pretty as a runtime dependency and would make
  // the container log human-shaped rather than machine-shaped. `npm run dev |
  // npx pino-pretty` is the local ergonomic answer.
  base: undefined, // drop pid/hostname; the platform already labels the stream
  timestamp: pino.stdTimeFunctions.isoTime,

  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["stripe-signature"]',
      '*.passwordHash',
      '*.password',
    ],
    censor: '[redacted]',
  },
});

module.exports = logger;
