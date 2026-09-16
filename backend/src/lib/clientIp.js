/**
 * The one trustworthy source of the real client IP behind the Lambda Web
 * Adapter.
 *
 * Found in 6.9 by actually spoofing headers against the deployed Function
 * URL: X-Forwarded-For is not sanitized at any point in this path. With no
 * CloudFront or ALB in front of the Function URL, the header the adapter
 * hands Express is exactly whatever the caller sent - `curl -H
 * "X-Forwarded-For: 1.2.3.4"` was echoed back as `req.headers['x-forwarded-
 * for']` unchanged, with no trace of the real address. That makes
 * `app.set('trust proxy', N)` for any N > 0 actively worse than the current
 * 0: it would let a caller mint a fresh rate-limit bucket on every request
 * for the price of one header.
 *
 * The real source IP does reach the app, just not as X-Forwarded-For: AWS
 * puts it in `requestContext.http.sourceIp` on the Function URL event, and
 * the adapter forwards that whole context as the `x-amzn-request-context`
 * header. Trying to forge that header the same way (a fake
 * `x-amzn-request-context` with a different sourceIp) had no effect - AWS
 * overwrites it before the adapter ever sees the request, the same
 * guarantee every `x-amzn-*` header carries.
 */
const getTrustedClientIp = (req) => {
  const raw = req.headers['x-amzn-request-context'];

  if (raw) {
    try {
      const sourceIp = JSON.parse(raw)?.http?.sourceIp;
      if (sourceIp) return sourceIp;
    } catch {
      // Malformed - fall through to req.ip rather than fail the request.
    }
  }

  // Not running behind the adapter (local dev, docker compose, tests).
  return req.ip;
};

module.exports = { getTrustedClientIp };
