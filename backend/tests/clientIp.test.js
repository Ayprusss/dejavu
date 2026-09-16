const { getTrustedClientIp } = require('../src/lib/clientIp');

/**
 * Found in 6.9 by spoofing headers against the deployed Function URL:
 * X-Forwarded-For reaches Express unsanitized (no CloudFront/ALB in front),
 * so it's the one header this function must never read. The real IP lives
 * in x-amzn-request-context, which the adapter overwrites regardless of
 * what a caller sends — confirmed live, not just asserted here.
 */
describe('getTrustedClientIp', () => {
  it('reads sourceIp from x-amzn-request-context when present', () => {
    const req = {
      headers: {
        'x-amzn-request-context': JSON.stringify({ http: { sourceIp: '203.0.113.7' } }),
        'x-forwarded-for': '1.2.3.4',
      },
      ip: '::ffff:127.0.0.1',
    };

    expect(getTrustedClientIp(req)).toBe('203.0.113.7');
  });

  it('ignores x-forwarded-for even when x-amzn-request-context is absent', () => {
    const req = {
      headers: { 'x-forwarded-for': '1.2.3.4' },
      ip: '::ffff:127.0.0.1',
    };

    expect(getTrustedClientIp(req)).toBe(req.ip);
  });

  it('falls back to req.ip when x-amzn-request-context is malformed', () => {
    const req = {
      headers: { 'x-amzn-request-context': 'not json' },
      ip: '::ffff:127.0.0.1',
    };

    expect(getTrustedClientIp(req)).toBe(req.ip);
  });

  it('falls back to req.ip when x-amzn-request-context has no sourceIp', () => {
    const req = {
      headers: { 'x-amzn-request-context': JSON.stringify({ http: {} }) },
      ip: '::ffff:127.0.0.1',
    };

    expect(getTrustedClientIp(req)).toBe(req.ip);
  });

  it('falls back to req.ip locally, where the header never exists', () => {
    const req = { headers: {}, ip: '127.0.0.1' };

    expect(getTrustedClientIp(req)).toBe('127.0.0.1');
  });
});
