# feedhook

[![CI](https://github.com/maelbel/feedhook/actions/workflows/ci.yml/badge.svg)](https://github.com/maelbel/feedhook/actions/workflows/ci.yml)

Self-hosted notifier that watches RSS/Atom feeds and posts each **new** item,
exactly once, to a **Discord channel per source** through webhooks.

Built with NestJS as a standalone application: no HTTP server, no open port,
only scheduled outbound requests. Designed to run in Docker on a Raspberry Pi.

| Source | Feed | Discord channel |
|---|---|---|
| Nuxt blog | `https://nuxt.com/blog/rss.xml` | `#nuxt-news` |
| NestJS releases | `https://github.com/nestjs/nest/releases.atom` | `#nestjs-news` |

> Status: **early development**. See [docs/PLAN.md](docs/PLAN.md) and the
> GitHub issues for the roadmap.

## How it works

At startup and then every hour, feedhook fetches each feed, keeps the items
it has not seen yet (stored in SQLite), and posts them to that feed's Discord
webhook as embeds, oldest first.

- **First run**: existing items are only recorded, so old posts don't flood
  the channel.
- **At most 5 posts per feed per cycle**; the rest follows on the next cycle.
- **An item is marked as seen only once Discord accepted it**: if Discord is
  down, it is posted on a later cycle, in order.
- **One feed failing** (timeout, invalid document, Discord error) never
  stops the others.

Each cycle ends with one log line:

```
LOG  [CycleService] cycle done in 682 ms: nuxt-blog posted 1, nestjs-releases not-modified
```

## Requirements

- Node.js 24 (`.nvmrc`)
- npm

## Getting started

```bash
npm ci
cp .env.example .env   # then fill in your Discord webhook URLs
npm run start:dev
```

Create a webhook in Discord: *Channel settings → Integrations → Webhooks →
New webhook → Copy webhook URL*. Treat it like a password.

## Run with Docker (Raspberry Pi)

```bash
git clone https://github.com/maelbel/feedhook.git && cd feedhook
cp .env.example .env && chmod 600 .env   # fill in the two webhook URLs
docker compose up -d --build
docker compose logs -f feedhook
```

The first cycle runs at startup and only records the existing articles;
from then on, every new article is posted. To change the feeds, edit
`feeds.yaml` (mounted read-only) and run `docker compose restart feedhook`.

What the container is allowed to do:

| | |
|---|---|
| User | `node` (uid 1000), not root; application files read-only |
| Filesystem | read-only, except the `feedhook-data` volume (`/data`, the SQLite database) and a 16 MB `/tmp` |
| Privileges | all Linux capabilities dropped, `no-new-privileges` |
| Network | outbound only, no port exposed (no Traefik needed) |
| Resources | 256 MB RAM, half a CPU, 100 processes, logs capped at 3 × 10 MB |

Instead of building on the Pi, you can use the published image (from
v1.0.0 on): in `docker-compose.yml`, replace `build: .` and `image:` with
`image: ghcr.io/maelbel/feedhook:1`.

`docker stop` lets the current post finish before closing the database.
The database lives in the `feedhook-data` volume: it survives restarts and
image updates (`git pull && docker compose up -d --build`).

## Monitoring

**Docker healthcheck.** After every cycle, feedhook writes `heartbeat.json`
in `/data`. `docker ps` shows the container as `unhealthy` when no cycle has
finished for more than two poll intervals plus 5 minutes (2 h 05 with the
hourly default, derived from `POLL_CRON`). A feed being down does not make
the container unhealthy: restarting would not bring a website back.

**Uptime Kuma (optional).** In Uptime Kuma, add a monitor of type **Push**,
set its *Heartbeat Interval* a bit above the poll interval (e.g. 3900 s for
hourly), copy the push URL into `.env`:

```
UPTIME_KUMA_PUSH_URL=https://uptime.example.com/api/push/<token>?status=up&msg=OK&ping=
```

After each cycle feedhook pushes `up` (all feeds fine) or `down` with the
failing feeds, e.g. `1 feed(s) failed: nuxt-blog (request failed: timeout)`,
and the cycle duration as the ping. No push within the interval means
feedhook itself stopped. The push URL contains a token: it is treated as a
secret and never logged.

## Configuration

- `feeds.yaml`: the feeds to watch. Each feed references the **name** of the
  environment variable holding its webhook (`webhookEnv`), never the URL itself.
- `.env`: secrets and settings (see `.env.example`).

Everything is validated at startup. If something is wrong, feedhook lists
every problem and exits, before fetching anything:

```
ERROR [ExceptionHandler] [ConfigError: Invalid configuration:
  - env POLL_CRON: must be a cron expression like "0 * * * *"
  - feeds.yaml: feeds[1].webhookEnv: environment variable DISCORD_WEBHOOK_NESTJS is not set]
```

| Field | Rule |
|---|---|
| `id` | lowercase letters, digits and dashes (`nuxt-blog`), unique |
| `name` | 1 to 100 characters |
| `url` | `https://` only, no credentials in the URL |
| `color` | hex colour, `#RRGGBB` |
| `webhookEnv` | name of an env var (`DISCORD_WEBHOOK_NUXT`) holding a Discord webhook URL |

| Variable | Default | Notes |
|---|---|---|
| `DISCORD_WEBHOOK_*` | | one per feed, named in `feeds.yaml` |
| `POLL_CRON` | `0 * * * *` | every hour |
| `DATA_DIR` | `./data` | SQLite database folder (`feedhook.db`), created with `700` permissions |
| `FEEDS_FILE` | `feeds.yaml` | path to the feeds file |
| `UPTIME_KUMA_PUSH_URL` | | optional Uptime Kuma push URL, `https://` only, see Monitoring |

Webhook URLs are secrets: they are never printed, even in error messages.

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Run with watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | Lint with oxlint |
| `npm run typecheck` | Type-check without emitting |
| `npm run format:check` | Check formatting with Prettier |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests |

## Contributing

Pull requests into `main` + Conventional Commits. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
