# Contributing

## Branches

A single long-lived branch, `main`, kept always green. Every change goes
through a short-lived branch and a pull request into `main`.

| Branch | Purpose |
|---|---|
| `main` | Always working. Releases are tags on it (`vX.Y.Z`). |
| `feature/<issue>-<short-name>` | New work, e.g. `feature/3-fetcher-module`. |
| `fix/<issue>-<short-name>` | Bug fix. |
| `chore/<short-name>` | Tooling, docs, maintenance. |

Branch from an up-to-date `main`, open the pull request against `main`, and
link the issue (`Closes #3`). Delete the branch once merged.

To release: update the version and CHANGELOG in a PR, merge it, then tag
`main` (`git tag v1.0.0 && git push origin v1.0.0`). The `Release` workflow
reruns every check, then publishes `ghcr.io/maelbel/feedhook` for amd64 and
arm64 (tags `1.0.0`, `1.0`, `1`, `latest`), with an SBOM and build provenance.

## Continuous integration

Every pull request and every push to `main` runs `.github/workflows/ci.yml`:

- lint, typecheck, format check, unit and e2e tests, build;
- `npm audit` on production dependencies (high and critical fail the build);
- the Docker image built on amd64 **and on a native arm64 runner** (the Pi's
  architecture), then started offline with the same restrictions as
  `docker-compose.yml` (read-only, no capabilities, `no-new-privileges`) and
  checked: config valid, database opened by the `node` user, one cycle,
  clean stop, no webhook URL in the logs.

Workflow rules: actions pinned by full commit SHA (Dependabot updates them),
`permissions: contents: read` by default, `packages: write` only for the
publish job, checkout without persisted credentials.

## Commits (Conventional Commits)

```
<type>(<optional scope>): <short summary>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, `revert`. Breaking changes: `feat!:` or a `BREAKING CHANGE:`
footer.

Examples:

```
feat(config): validate feeds.yaml with zod
fix(discord): respect retry_after on 429
ci: build multi-arch image
```

## Before opening a PR

```bash
npm run lint && npm run typecheck && npm run format:check && npm test && npm run test:e2e
```

## Secrets

Never commit a webhook URL, `.env`, or the SQLite database. `.env.example`
documents every variable with placeholder values.
