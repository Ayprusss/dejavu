const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const productRoutes = require('./routes/router');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const { loginLimiter, checkoutLimiter } = require('./middleware/rateLimit');
const logger = require('./lib/logger');
const pool = require('./db/pool');
const env = require('./config/env');

const app = express();

// How many proxies sit in front of us. The rate limiters key on the client IP,
// and with this unset behind a proxy every request appears to come from the
// proxy — one bucket for the whole internet. Set too high, a client can spoof
// X-Forwarded-For and get a fresh bucket per request. Neither default is safe
// to guess, so it comes from the environment.
app.set('trust proxy', env.TRUST_PROXY);

// Sensible security headers. This is a JSON API with no HTML of its own, so the
// default CSP would only ever apply to error pages; it is left on because
// nothing here needs to load cross-origin resources.
app.use(helmet());

app.use(
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  }),
);

app.use(
  pinoHttp({
    logger,
    // The health checks are polled continuously by the platform and would
    // otherwise be the overwhelming majority of the log volume.
    autoLogging: {
      ignore: (req) => req.url === '/api/status' || req.url === '/api/ready',
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }),
);

// Stripe webhooks require the raw body for signature validation.
// This route MUST be registered BEFORE express.json().
//
// Do not hoist a global body parser above this line. express.json() consumes
// the stream and hands the handler a parsed object, and re-serialising it does
// not reproduce the exact bytes Stripe signed — the signature check then fails
// for every delivery.
app.use(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  webhookRoutes,
);

app.use(express.json());
app.use('/api/products', productRoutes);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/checkout', checkoutLimiter, checkoutRoutes);

/**
 * Liveness. Deliberately does not touch the database.
 *
 * This answers "is the process wedged", and the honest answer stays "no" while
 * the database is unreachable. Wiring a DB ping in here means a database blip
 * gets the container killed and restarted, which fixes nothing and drops the
 * requests it could still have served.
 */
app.get('/api/status', (_req, res) => {
  res.status(200).json({
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
  });
});

/**
 * Readiness. Answers "should traffic be routed here right now", so this one
 * does check the database, because an instance that cannot reach it cannot
 * serve most of the API.
 */
app.get('/api/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    logger.error({ event: 'readiness.failed', err: error }, 'Readiness check failed');
    res.status(503).json({ status: 'unavailable' });
  }
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// Anything that matched no route above.
app.use((req, res) => {
  res.status(404).json({ message: `Cannot ${req.method} ${req.originalUrl}` });
});

/**
 * Terminal error handler.
 *
 * Express needs all four parameters to recognise this as error middleware, so
 * `next` stays even though it is unused. Nothing about the error reaches the
 * client — stack traces in a 500 body were a Phase 0 finding, and the fix does
 * not get to regress here.
 */
app.use((err, req, res, _next) => {
  req.log?.error({ event: 'request.unhandled', err }, 'Unhandled error');

  if (res.headersSent) return;

  res.status(err.status || 500).json({ message: 'Internal server error' });
});

module.exports = app;
