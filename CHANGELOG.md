# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project setup: NestJS standalone application, Vitest, oxlint, Prettier.
- Config module: `feeds.yaml` and environment validated with zod at startup,
  all problems reported at once, webhook URLs wrapped in a `Secret` so they
  are never logged (#2).
- Fetcher module: https-only downloads (every redirect hop checked), one
  10 s timeout covering the body, 2 MB size cap while streaming, and
  ETag / Last-Modified conditional requests (`304 Not Modified`) (#3).
- Parser module: RSS 2.0 and Atom to a common `FeedItem` (id, title, link,
  date, plain-text summary, image); only http(s) links and images kept,
  HTML reduced to text, every field bounded, at most 100 items (#4).
- Store module: SQLite database in `DATA_DIR` (built-in `node:sqlite`,
  numbered migrations, WAL) remembering posted items, the silent first-run
  seed and HTTP cache validators per feed (#5).
- Discord module: one embed per item (title, link, feed colour, date,
  summary, thumbnail) posted with `?wait=true`; mentions disabled, feed
  markdown escaped (no masked links), Discord limits enforced; 429 waits
  for `retry_after`, 5xx and network errors retried with backoff, other 4xx
  fail at once; webhook URL never logged (#6).
- Scheduler: one cycle at startup then on `POLL_CRON` (hourly); per feed:
  fetch, parse, silent seed on the first run, post new items oldest first
  (max 5 per feed per cycle), mark as seen after each accepted post; a
  failing feed never blocks the others, cycles never overlap, shutdown
  waits for the current post. `POLL_CRON` is now fully validated (#7).
