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
