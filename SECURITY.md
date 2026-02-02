# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (main/dev branch) | ✅ Yes |
| Older versions | ❌ No |

We only support the latest version. Please ensure you're running the most recent release before reporting.

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

### Preferred: GitHub Security Advisories

1. Go to the **Security** tab of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details

### Alternative: Email

If Security Advisories are not available, email us at: **security@litewrite.ai**

### Response Timeline

| Stage | Timeline |
|-------|----------|
| Initial response | Within 48 hours |
| Triage & assessment | Within 7 days |
| Fix & disclosure | Coordinated with reporter |

## What to Include

Please provide as much information as possible:

- **Description**: What is the vulnerability and its potential impact?
- **Steps to reproduce**: Minimal steps to trigger the issue
- **Affected versions**: Commit hash or version number
- **Environment**: OS, browser, Docker version, etc.
- **Mitigations**: Any known workarounds or patches

## Secrets Policy

**Never share secrets in:**
- Issues or pull requests
- Logs or screenshots
- Public channels

**Examples of secrets:**
- API keys (`OPENROUTER_API_KEY`, `SERPER_API_KEY`, etc.)
- Auth secrets (`NEXTAUTH_SECRET`, `INTERNAL_API_SECRET`)
- Database credentials (`DATABASE_URL`)
- S3/storage credentials

If you accidentally exposed a secret, **rotate it immediately**.

## Security Best Practices for Self-Hosters

1. **Keep dependencies updated** - Run `npm audit` and `pip audit` regularly
2. **Use HTTPS** - Always deploy behind a reverse proxy with TLS
3. **Rotate secrets** - Change production secrets periodically
4. **Limit network exposure** - Only expose necessary ports (3000, 443)
5. **Monitor logs** - Watch for unusual activity

## Acknowledgments

We appreciate responsible disclosure. Contributors who report valid security issues will be acknowledged in our release notes (unless they prefer to remain anonymous).
