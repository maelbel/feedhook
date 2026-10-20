# feedhook — notes for Claude Code

feedhook watches RSS/Atom feeds and posts each new item, exactly once, to a
Discord webhook per source. NestJS **standalone application**
(`NestFactory.createApplicationContext`): no HTTP server, no open port.
Runs in Docker on a Raspberry Pi 5 (arm64). The plan is `docs/PLAN.md`.

## Layout

```
src/
  main.ts          bootstrap (standalone context + shutdown hooks)
  app.module.ts    root module, imports the feature modules
  config/          feeds.yaml + env loading, zod validation        (issue #2)
  fetcher/         HTTPS GET: timeout, size limit, ETag/Last-Modified (#3)
  parser/          RSS 2.0 / Atom -> FeedItem                       (#4)
  store/           SQLite: seen_items, feed_state                   (#5)
  discord/         webhook embeds, allowed_mentions, 429/retry      (#6)
  scheduler/       hourly cycle, silent seed, cap, lock             (#7)
test/
  fixtures/        sample feeds used by tests
feeds.yaml         feeds to watch (no secrets: webhookEnv = env var NAME)
```

## Commands

```sh
npm ci
npm run start:dev
npm run lint && npm run typecheck && npm run format:check   # before saying "done"
npm test && npm run test:e2e
npm run build
```

## Workflow

- Single `main` branch: short-lived `feature/<issue>-<name>`, `fix/…` or
  `chore/…` branches from `main`, PRs into `main`. Releases are tags on
  `main` (`vX.Y.Z`). No `develop` branch.
- Conventional Commits.
- **Always ask before committing**; push only after an approved commit; open
  a PR only after approval.

## Conventions

- ESM (`"type": "module"`): relative imports end in `.js`.
- TypeScript strict. No `any` in new code.
- One Nest module per folder; services are injectable and unit-tested with
  `@nestjs/testing`. Tests next to the code (`*.spec.ts`), fixtures in
  `test/fixtures/`, no real network in tests.
- **Config**: inject `AppConfig` (from `src/config`); never read `process.env`
  elsewhere. New settings go in `config.schema.ts` + `load-config.ts`, with
  tests, `.env.example` and the README table.
- **Secrets**: webhook URLs come from env vars only and are `Secret` objects;
  call `.reveal()` only at the point of use (the HTTP request), never log it.
- **Feeds are untrusted**: only `https://` URLs, timeout + max size, strip
  HTML, truncate to Discord limits, `allowed_mentions: { parse: [] }`,
  escape markdown in descriptions (`escapeMarkdown`, no masked links).
- Mark an item as seen **only after** Discord accepted it.
- **Database**: `node:sqlite` with `?` placeholders only (never build SQL
  from strings). Schema changes = a **new** entry at the end of
  `src/store/migrations.ts`; never edit a released one.
