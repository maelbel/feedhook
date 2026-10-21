# feedhook — Plan (v1)

> Name: **feedhook**
> Repo: **public**, on Mael's personal GitHub account
> Status: **approved** (2026-10-19). Tracked in GitHub issues on `maelbel/feedhook`.

## 1. Goal

A small self-hosted service on the Raspberry Pi that watches RSS/Atom feeds and posts each **new** item **exactly once** to a **dedicated Discord channel per source** through webhooks.

### In scope (v1)
| Source | Feed URL | Discord channel |
|---|---|---|
| Nuxt blog | `https://nuxt.com/blog/rss.xml` | `#nuxt-news` (own webhook) |
| NestJS releases | `https://github.com/nestjs/nest/releases.atom` | `#nestjs-news` (own webhook) |

### Out of scope (v1, possible later)
- NestJS newsletter via Kill the Newsletter (v2: just another feed entry)
- LinkedIn (no reliable/legal source)
- Web UI / HTTP API, per-feed keyword filters

## 2. Decisions
- Framework: **NestJS** (TypeScript, Node.js 24 LTS)
- Polling interval: **1 hour**
- **One Discord webhook per source** (separate channels)
- Runs as a Docker container on the Pi (arm64), alongside the existing stack

## 3. Architecture

The app is a NestJS **standalone application** (`NestFactory.createApplicationContext`). It has no HTTP server and no open port, only scheduled jobs.

```
          ┌──────────────────── feedhook (NestJS standalone) ────────────────────┐
 feeds ──▶│ PollerService ─▶ FetcherService ─▶ ParserService ─▶ StoreService ─▶ DiscordService │
 (HTTPS)  │  (@Cron hourly)                                   │              │
          │                                              SQLite (volume)     │
          └──────────────────────────────────────────────────────────────────┘
                                                        ├─▶ webhook #nuxt-news
                                                        └─▶ webhook #nestjs-news
```

| Nest module | Responsibility |
|---|---|
| `ConfigModule` | `@nestjs/config` loads `feeds.yaml` and env vars, validated with zod. The app fails fast on invalid config. |
| `SchedulerModule` | `@nestjs/schedule`: runs one cycle at boot, then on `POLL_CRON`. A lock prevents overlapping cycles; new ETag / Last-Modified saved only once every new item is posted (otherwise a 304 would hide the waiting items). |
| `FetcherModule` | HTTPS GET with timeout, max body size, `User-Agent`, and conditional requests (`ETag` / `If-Modified-Since`). |
| `ParserModule` | Parses RSS 2.0 and Atom into a common `FeedItem { id, title, link, date, image? }`. |
| `StoreModule` | SQLite (Node's built-in `node:sqlite`, plain SQL, numbered migrations) with tables `seen_items(feed_id, item_id, seen_at)` and `feed_state(feed_id, etag, last_modified, seeded_at)`. |
| `DiscordModule` | Builds the embed, sends it to the feed's webhook, and handles `429` (`retry_after`) and 5xx retries. |

### Key behaviours
- **First run is a silent seed**: existing items are marked as seen without being posted, so old articles don't flood the channel.
- **Dedupe key**: `guid`/`id`, falling back to `link`.
- **Order**: new items are posted oldest to newest.
- **Cap**: at most N items per feed per cycle (default 5).
- **Items are marked as seen only after a successful post**, so nothing is lost if Discord is down.
- One failing feed never blocks the others.

### Config example (`feeds.yaml`, committed, contains no secrets)
```yaml
feeds:
  - id: nuxt-blog
    name: Nuxt Blog
    url: https://nuxt.com/blog/rss.xml
    color: "#00DC82"
    webhookEnv: DISCORD_WEBHOOK_NUXT      # name of the env var, not the URL
  - id: nestjs-releases
    name: NestJS Releases
    url: https://github.com/nestjs/nest/releases.atom
    color: "#E0234E"
    webhookEnv: DISCORD_WEBHOOK_NESTJS
```

`.env` (never committed):
```
DISCORD_WEBHOOK_NUXT=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_NESTJS=https://discord.com/api/webhooks/...
POLL_CRON=0 * * * *
UPTIME_KUMA_PUSH_URL=...
```

## 4. Stack

| Need | Choice |
|---|---|
| Framework | NestJS 12 (standalone app, ESM), TypeScript strict, Node.js 24 LTS |
| Scheduling | `@nestjs/schedule` |
| Config | `@nestjs/config` + `zod` + `yaml` |
| Feed parsing | `@rowanmanning/feed-parser` (on `fast-xml-parser`; `rss-parser` is unmaintained since 2023) + `html-entities` |
| Storage | Built-in `node:sqlite` (Node 24), plain SQL + migrations, WAL mode; file on a Docker volume. Chosen over TypeORM + `better-sqlite3`: two small tables, no ORM, no native module to build for arm64 |
| Logging | `nestjs-pino` (JSON logs, secrets redacted) |
| Tests | Vitest (Nest 12 default) with fixture feeds and mocked HTTP |
| Quality | oxlint (Nest 12 default) + Prettier, `tsc --noEmit` |
| CI | GitHub Actions: lint, test, audit, Docker build + smoke test on native amd64 and arm64 runners; on `v*` tags, multi-arch image to GHCR (base digest pinned, SBOM, provenance) |

## 5. Security

- **Webhook URLs are secrets**: one env var per feed. `feeds.yaml` only references the variable name, and startup fails if a referenced variable is missing. URLs are never logged (pino `redact`). `.env` is in `.gitignore`; `.env.example` is committed.
- **Webhook URL validation**: it must match `https://discord.com/api/webhooks/...`.
- **No inbound traffic**: the app is standalone with no HTTP server, no exposed port, and is not behind Traefik. It only makes outbound requests.
- **Container hardening**: non-root user, `read_only: true` (except the data volume), `cap_drop: [ALL]`, `no-new-privileges`, a minimal base image, and memory/CPU limits.
- **Untrusted input** (feed content):
  - Config validation only allows `https://` feed URLs.
  - Every request has a timeout and a maximum response size.
  - Discord `allowed_mentions: { parse: [] }` means a feed can never trigger `@everyone`.
  - HTML is stripped and text is truncated to Discord limits.
- **Supply chain**: committed lockfile, `npm ci`, Dependabot, `npm audit` in CI, and an exact base image version (`node:24.22.0-alpine`) kept up to date by Dependabot; the digest is pinned in CI (#9), where the registry is reachable.
- **Respect for sources**: hourly polling plus conditional requests.

## 6. Operations

- A `docker-compose.yml` service in the homelab stack with `restart: unless-stopped`.
- **Monitoring**: an Uptime Kuma push monitor. The app pings it after each successful cycle (the URL is a secret), with the heartbeat interval set to about 65 minutes.
- Healthcheck: a heartbeat file updated each cycle.
- Logs via `docker logs` (JSON).

## 7. Repo & workflow

- **Branches**: a single `main` branch; `feature/*`, `fix/*`, `chore/*` branches merged into it by PR; releases are tags on `main`. (Gitflow's `develop` branch was dropped as too heavy for one maintainer.)
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `test:`).
- Each commit is approved before it is made. Pushing happens after an approved commit; a PR is opened only after approval.
- Structure:
```
src/
  config/  scheduler/  fetcher/  parser/  store/  discord/
  app.module.ts
  main.ts            # createApplicationContext
test/
  fixtures/ (nuxt-rss.xml, nestjs-releases.atom)
feeds.yaml
Dockerfile
docker-compose.yml
.env.example
```

## 8. Milestones → GitHub issues (created only after approval)

| # | Issue | Type |
|---|---|---|
| 1 | Project setup: Nest standalone app, oxlint, Prettier, Vitest, branches, README | chore |
| 2 | ConfigModule: `feeds.yaml` and env loading, zod validation (https-only, per-feed webhook env) | feat |
| 3 | FetcherModule: timeout, size limit, conditional requests | feat |
| 4 | ParserModule: RSS and Atom to `FeedItem` (with fixtures) | feat |
| 5 | StoreModule: SQLite seen items and feed state | feat |
| 6 | DiscordModule: per-feed webhook, embed, `allowed_mentions`, 429/retry | feat |
| 7 | SchedulerModule: hourly cycle, silent seed, cap, ordering, isolation, lock | feat |
| 8 | Dockerfile (multi-stage, arm64, non-root) and compose hardening | chore |
| 9 | CI: lint, test, audit, multi-arch build to GHCR | ci |
| 10 | Uptime Kuma push monitor and healthcheck | feat |
| 11 | Release v1.0.0 and deploy on the Pi | chore |

## 9. Decisions log
1. **Project name**: `feedhook`.
2. **GitHub repo**: public, on the personal account.
