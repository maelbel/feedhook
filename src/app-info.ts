import { readFileSync } from 'node:fs';

/**
 * Name and version, read once from package.json. The path is the same from
 * `src/` (tests) and `dist/` (production): both sit next to package.json.
 */
const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string };

export const APP_NAME = pkg.name;
export const APP_VERSION = pkg.version;
export const REPO_URL = 'https://github.com/maelbel/feedhook';
