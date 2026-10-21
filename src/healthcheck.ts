/**
 * Docker HEALTHCHECK entry point: `node dist/healthcheck.js`.
 *
 * Deliberately tiny and Nest-free (it runs every few minutes next to the
 * app): it reads the heartbeat file and exits 0 (healthy) or 1 (unhealthy).
 * It is the one place that reads `process.env` directly, because it runs
 * outside the application and only needs DATA_DIR.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkHeartbeat, HEARTBEAT_FILE } from './monitoring/heartbeat.js';

function readHeartbeat(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

const path = join(process.env.DATA_DIR || './data', HEARTBEAT_FILE);
const result = checkHeartbeat(readHeartbeat(path), Date.now());
console.log(`${result.healthy ? 'healthy' : 'unhealthy'}: ${result.reason}`);
process.exitCode = result.healthy ? 0 : 1;
