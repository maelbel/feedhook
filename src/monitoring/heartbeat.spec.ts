import { checkHeartbeat, maxAgeFor } from './heartbeat.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const HOUR = 60 * 60_000;
const beat = (minutesAgo: number, maxAgeMs = maxAgeFor(HOUR)): string =>
  JSON.stringify({
    lastCycleAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
    maxAgeMs,
    ok: true,
  });

describe('maxAgeFor', () => {
  it('tolerates one missed cycle plus 5 minutes', () => {
    expect(maxAgeFor(HOUR)).toBe(125 * 60_000);
  });
});

describe('checkHeartbeat', () => {
  it('is healthy after a recent cycle', () => {
    expect(checkHeartbeat(beat(10), NOW)).toEqual({
      healthy: true,
      reason: 'last cycle 10 min ago',
    });
  });

  it('stays healthy when one hourly cycle was missed', () => {
    expect(checkHeartbeat(beat(119), NOW).healthy).toBe(true);
  });

  it('is unhealthy when cycles stopped', () => {
    expect(checkHeartbeat(beat(130), NOW)).toEqual({
      healthy: false,
      reason: 'last cycle 130 min ago, more than 125 min',
    });
  });

  it('stays healthy after a cycle where a feed failed (a restart would not help)', () => {
    const content = JSON.stringify({ ...JSON.parse(beat(5)), ok: false });

    expect(checkHeartbeat(content, NOW).healthy).toBe(true);
  });

  it.each([
    [undefined, 'no heartbeat yet'],
    ['not json', 'not valid JSON'],
    ['{"lastCycleAt":"yesterday"}', 'incomplete'],
    ['{"lastCycleAt":"2026-10-21T11:00:00Z","maxAgeMs":-1}', 'incomplete'],
  ])('is unhealthy for %s', (content, reason) => {
    const result = checkHeartbeat(content, NOW);

    expect(result.healthy).toBe(false);
    expect(result.reason).toContain(reason);
  });
});
