# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability
reporting instead: *Security → Report a vulnerability* on this repository.

## Design notes

- Discord webhook URLs are secrets. They are read from environment variables
  only, never committed, and redacted from logs.
- feedhook opens no port: it only makes outbound HTTPS requests.
- Feed content is untrusted: HTML is stripped, text is truncated to Discord's
  limits, and mentions are disabled (`allowed_mentions: { parse: [] }`), so a
  feed can never ping `@everyone`.
