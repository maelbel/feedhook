# Contributing

## Branches (Gitflow)

| Branch | Purpose |
|---|---|
| `main` | Released code only. Every merge is tagged (`vX.Y.Z`). |
| `develop` | Integration branch for the next release. |
| `feature/<issue>-<short-name>` | New work, branched from `develop`, e.g. `feature/2-config-module`. |
| `release/<version>` | Release preparation, from `develop`, merged into `main` and `develop`. |
| `hotfix/<version>` | Urgent fix from `main`, merged into `main` and `develop`. |

Open pull requests against `develop` (or `main` for releases/hotfixes) and
link the issue (`Closes #2`).

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
