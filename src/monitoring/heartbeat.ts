/**
 * The heartbeat file, written in DATA_DIR after every completed cycle and
 * read by the Docker healthcheck (`dist/healthcheck.js`). Shared here so the
 * writer and the reader can never disagree on its format.
 */
export const HEARTBEAT_FILE = 'heartbeat.json';

export interface Heartbeat {
  /** When the last cycle finished (ISO date). */
  readonly lastCycleAt: string;
  /** Older than this, the app is considered stuck (2 poll intervals + 5 min). */
  readonly maxAgeMs: number;
  /** Whether every feed went fine in that cycle (informative only). */
  readonly ok: boolean;
}

const GRACE_MS = 5 * 60_000;

/** Two poll intervals plus a grace period: one missed cycle is tolerated. */
export function maxAgeFor(pollIntervalMs: number): number {
  return 2 * pollIntervalMs + GRACE_MS;
}

export interface HealthResult {
  readonly healthy: boolean;
  readonly reason: string;
}

/**
 * Healthy when a cycle finished recently enough. A feed failing does not
 * make the container unhealthy (restarting would not fix a down website);
 * only a scheduler that stopped cycling does.
 */
export function checkHeartbeat(
  content: string | undefined,
  now: number,
): HealthResult {
  if (content === undefined) {
    return {
      healthy: false,
      reason: 'no heartbeat yet (no cycle has finished)',
    };
  }
  let heartbeat: Partial<Heartbeat>;
  try {
    heartbeat = JSON.parse(content) as Partial<Heartbeat>;
  } catch {
    return { healthy: false, reason: 'heartbeat file is not valid JSON' };
  }
  const last = Date.parse(String(heartbeat.lastCycleAt));
  const maxAge = Number(heartbeat.maxAgeMs);
  if (Number.isNaN(last) || !Number.isFinite(maxAge) || maxAge <= 0) {
    return { healthy: false, reason: 'heartbeat file is incomplete' };
  }
  const ageMs = now - last;
  const age = `${Math.round(ageMs / 60_000)} min ago`;
  return ageMs <= maxAge
    ? { healthy: true, reason: `last cycle ${age}` }
    : {
        healthy: false,
        reason: `last cycle ${age}, more than ${Math.round(maxAge / 60_000)} min`,
      };
}
