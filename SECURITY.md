# Security Policy

## Supported Versions

We prioritize security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | ✅ Yes             |
| < 1.0   | ❌ No              |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please email **security@thijsvtol.com** instead of using the issue tracker.

### Please include:

1. **Description** - A detailed description of the vulnerability
2. **Steps to Reproduce** - Clear steps to reproduce the issue
3. **Impact** - What could an attacker accomplish with this vulnerability?
4. **Affected Components** - Which parts of the application are affected?
5. **Suggested Fix** - If you have one (optional)

### What to expect:

- **Initial Response** - We'll acknowledge receipt within 48 hours
- **Assessment** - We'll assess the severity and impact
- **Timeline** - Critical issues will be addressed within 7 days
- **Disclosure** - We'll coordinate with you on public disclosure

## Security Practices

### Authentication & Authorization
- HTTP-only cookies for session tokens
- JWT validation with expiration
- CORS protection
- Admin-only endpoints protected by authentication middleware

### Data Protection
- Database queries use parameterized statements to prevent SQL injection
- Input validation on all API endpoints
- File upload validation
- EXIF data sanitization

### Infrastructure Security
- Cloudflare Workers for DDoS protection
- Environment variables for sensitive configuration
- Secrets not committed to version control
- R2 bucket access restricted to authenticated requests

### Dependency Security
- Regular `npm audit` checks
- Dependency updates prioritized for security patches
- Automated dependency scanning via GitHub Actions (recommended)

## Compliance

This project follows security best practices including:
- OWASP Top 10 awareness
- Regular security reviews
- Secure coding standards
- Input validation and output encoding

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare Security](https://www.cloudflare.com/security/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/nodejs-security/)

## Questions?

If you have security concerns or questions, please reach out to the maintainers.
