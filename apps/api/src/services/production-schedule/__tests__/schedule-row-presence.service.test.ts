import { describe, expect, it, vi } from 'vitest';
import { buildScheduleRowPresenceCondition, readScheduleRowPresence, resolveScheduleRowPresence } from '../schedule-row-presence.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

const run = (messageId: string, received = '2026-11-14T03:00:00Z') => ({
  status: 'COMPLETED', messageId, sourceReceivedAt: new Date(received),
  startedAt: new Date('2026-11-15T03:00:00Z'), rowSeenRecordedAt: new Date('2026-11-15T04:00:00Z')
});
const day = (date: string, count = 4) => Array.from({ length: count }, (_, i) => run(`${date}-${i}`, `${date}T03:00:00Z`));

describe('schedule row presence', () => {
  it('uses exactly four distinct messages and JST midnight', () => {
    expect(resolveScheduleRowPresence(day('2026-11-14'))).toEqual({ key: '2026-11-14', cutoff: new Date('2026-11-13T15:00:00Z') });
  });
  it('counts a re-ingested message once (three distinct messages)', () => {
    const runs = day('2026-11-14', 3);
    expect(resolveScheduleRowPresence([...runs, runs[0]!]).key).toBe('none');
  });
  it('keeps the preceding complete day when the next has two messages', () => {
    expect(resolveScheduleRowPresence([...day('2026-11-13'), ...day('2026-11-14', 2)]).key).toBe('2026-11-13');
  });
  it('groups at the JST calendar boundary using received time rather than start time', () => {
    const runs = Array.from({ length: 3 }, (_, i) => run(`${i}`, '2026-11-14T14:59:59.999Z'));
    expect(resolveScheduleRowPresence([...runs, run('fourth', '2026-11-14T15:00:00Z')]).key).toBe('none');
    expect(resolveScheduleRowPresence([...runs, run('fourth', '2026-11-14T14:59:59.999Z')]).key).toBe('2026-11-14');
  });
  it('falls back to startedAt when received time is absent', () => {
    expect(resolveScheduleRowPresence(day('2026-11-14').map((r) => ({ ...r, sourceReceivedAt: null }))).key).toBe('2026-11-15');
  });
  it.each(['unrecorded', 'failed', 'processing', 'no-message'])('does not count %s runs', (kind) => {
    const runs = day('2026-11-14');
    const excluded = { ...runs.pop()!, ...(kind === 'unrecorded' ? { rowSeenRecordedAt: null } : kind === 'no-message' ? { messageId: null } : { status: kind.toUpperCase() }) };
    expect(resolveScheduleRowPresence([...runs, excluded]).key).toBe('none');
  });
  it('rejects a five-message day and chooses the latest complete day regardless of input order', () => {
    expect(resolveScheduleRowPresence([...day('2026-11-15', 5), ...day('2026-11-14'), ...day('2026-11-13')]).key).toBe('2026-11-14');
  });
  it('disables hiding without a complete day', () => {
    expect(resolveScheduleRowPresence([])).toEqual({ key: 'none', cutoff: null });
    expect(buildScheduleRowPresenceCondition(null).sql).toBe('TRUE');
  });
  it('builds the shared row-level existence predicate with a bound inclusive cutoff', () => {
    const cutoff = new Date('2026-11-13T15:00:00Z');
    const sql = buildScheduleRowPresenceCondition(cutoff);
    expect(sql.sql).toContain('s."dataHash" = "CsvDashboardRow"."dataHash" AND s."lastSeenAt" >= ?');
    expect(sql.values).toEqual([cutoff]);
  });
  it('reads only eligible production schedule runs', async () => {
    const findMany = vi.fn().mockResolvedValue(day('2026-11-14'));
    expect((await readScheduleRowPresence({ csvDashboardIngestRun: { findMany } } as never)).key).toBe('2026-11-14');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, status: 'COMPLETED', rowSeenRecordedAt: { not: null }, messageId: { not: null }
    } }));
  });
});
