import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { machineSignalDailyReport: { findMany: mocks.findMany } } }));

import { clearSignalDaySummaryCache, loadSignalDaySummaries } from '../machine-signal-day-summary.cache.js';
import type { MachineSignalSensorDto } from '../machine-signal-settings.service.js';
import { DEFAULT_SIGNAL_THRESHOLDS } from '../signal-metrics.js';

const sensor: MachineSignalSensorDto = {
  signalNo: 1, sourceMachineName: '機械', displayName: null, site: null, kind: 'MACHINE', hidden: false,
  categoryOverrides: {}, plannedStartMinute: null, plannedEndMinute: null, runningKw: null, idleKw: null,
};
const date = (key: string) => new Date(`${key}T00:00:00.000Z`);
const metadata = { id: 'report-1', signalNo: 1, reportDate: date('2026-10-01'), updatedAt: date('2026-10-02') };
const report = { ...metadata, dayStartMinute: 480, stateNames: ['稼働'], segments: [[0, 86_400, 1, 1, 2, 0]] };
const params = { sensors: [sensor], thresholds: DEFAULT_SIGNAL_THRESHOLDS, from: '2026-10-01', to: '2026-10-03' };

describe('loadSignalDaySummaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearSignalDaySummaryCache();
    mocks.findMany.mockImplementation(async (query) => query.select.segments ? [report] : [metadata]);
  });

  it('reads only metadata on a cache hit and preserves the calculated summary', async () => {
    const first = await loadSignalDaySummaries(params);
    const second = await loadSignalDaySummaries(params);
    expect(first).toEqual(second);
    expect(second[0]).toMatchObject({ signalNo: 1, reportDate: '2026-10-01', runSeconds: 86_400, hint: 'GOOD' });
    expect(second[0]).not.toHaveProperty('timeline');
    expect(mocks.findMany).toHaveBeenCalledTimes(3);
    expect(mocks.findMany.mock.calls[0][0]).toEqual({
      where: { signalNo: { in: [1] }, reportDate: { gte: date('2026-10-01'), lte: date('2026-10-03') } },
      select: { id: true, signalNo: true, reportDate: true, updatedAt: true },
    });
    expect(mocks.findMany.mock.calls[1][0]).toEqual({
      where: { id: { in: ['report-1'] } },
      select: { id: true, signalNo: true, reportDate: true, dayStartMinute: true, stateNames: true, segments: true },
    });
  });

  it('rereads changed reports by updatedAt', async () => {
    await loadSignalDaySummaries(params);
    mocks.findMany.mockImplementation(async (query) => query.select.segments
      ? [{ ...report, segments: [] }] : [{ ...metadata, updatedAt: date('2026-10-03') }]);
    const result = await loadSignalDaySummaries(params);
    expect(mocks.findMany).toHaveBeenCalledTimes(4);
    expect(result[0]).toMatchObject({ hasRecord: false, hint: 'NO_RECORD' });
  });

  it.each([
    { categoryOverrides: { '112': 'STOP' as const } },
    { plannedStartMinute: 480 },
    { plannedEndMinute: 1_020 },
    { runningKw: 2 },
    { idleKw: 1 },
  ])('rereads when an effective sensor setting changes: %j', async (patch) => {
    await loadSignalDaySummaries(params);
    await loadSignalDaySummaries({ ...params, sensors: [{ ...sensor, ...patch }] });
    expect(mocks.findMany).toHaveBeenCalledTimes(4);
  });

  it('rereads when thresholds change', async () => {
    await loadSignalDaySummaries(params);
    await loadSignalDaySummaries({ ...params, thresholds: { ...DEFAULT_SIGNAL_THRESHOLDS, goodRunMinSeconds: 90_000 } });
    expect(mocks.findMany).toHaveBeenCalledTimes(4);
  });

  it('loads only stale ids when cached and uncached rows are mixed', async () => {
    await loadSignalDaySummaries(params);
    mocks.findMany.mockImplementation(async (query) => query.select.segments
      ? [{ ...report, id: 'report-2', reportDate: date('2026-10-02') }]
      : [metadata, { ...metadata, id: 'report-2', reportDate: date('2026-10-02') }]);
    const result = await loadSignalDaySummaries(params);
    expect(mocks.findMany.mock.calls[3][0].where).toEqual({ id: { in: ['report-2'] } });
    expect(result.map((summary) => summary.reportDate)).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('chunks ids into 500 reports and sorts by date then signal number', async () => {
    const reports = Array.from({ length: 1_001 }, (_, index) => ({
      ...report, id: `report-${index}`, signalNo: index + 1,
      reportDate: date(index % 2 ? '2026-10-01' : '2026-10-02'),
    })).reverse();
    mocks.findMany.mockImplementation(async (query) => query.select.segments
      ? reports.filter((row) => query.where.id.in.includes(row.id)) : reports);
    const result = await loadSignalDaySummaries({ ...params,
      sensors: reports.map((row) => ({ ...sensor, signalNo: row.signalNo })),
    });
    expect(mocks.findMany.mock.calls.slice(1).map(([query]) => query.where.id.in.length)).toEqual([500, 500, 1]);
    expect(result).toHaveLength(1_001);
    expect(result.slice(0, 2).map((row) => [row.reportDate, row.signalNo])).toEqual([['2026-10-01', 2], ['2026-10-01', 4]]);
    expect(result[500]).toMatchObject({ reportDate: '2026-10-02', signalNo: 1 });
    expect(result[1_000]).toMatchObject({ reportDate: '2026-10-02', signalNo: 1_001 });
  });

  it('does not read segments when no reports exist', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await loadSignalDaySummaries(params)).toEqual([]);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest inserted entry above 80000 even if it was recently read', async () => {
    const reports = Array.from({ length: 80_001 }, (_, index) => ({ ...report, id: `report-${index}` }));
    const byId = new Map(reports.map((row) => [row.id, row]));
    let selected = reports.slice(0, 80_000);
    mocks.findMany.mockImplementation(async (query) => query.select.segments
      ? query.where.id.in.map((id: string) => byId.get(id)) : selected);
    await loadSignalDaySummaries(params);
    expect(mocks.findMany).toHaveBeenCalledTimes(161);
    selected = [reports[0]];
    await loadSignalDaySummaries(params);
    expect(mocks.findMany).toHaveBeenCalledTimes(162);
    selected = [reports[80_000]];
    await loadSignalDaySummaries(params);
    expect(mocks.findMany).toHaveBeenCalledTimes(164);
    selected = [reports[79_999]];
    await loadSignalDaySummaries(params);
    expect(mocks.findMany).toHaveBeenCalledTimes(165);
    selected = [reports[0]];
    await loadSignalDaySummaries(params);
    expect(mocks.findMany).toHaveBeenCalledTimes(167);
    expect(mocks.findMany.mock.calls[166][0].where.id.in).toEqual(['report-0']);
  });

  it('clears cached summaries for tests', async () => {
    await loadSignalDaySummaries(params);
    clearSignalDaySummaryCache();
    await loadSignalDaySummaries(params);
    expect(mocks.findMany).toHaveBeenCalledTimes(4);
  });
});
