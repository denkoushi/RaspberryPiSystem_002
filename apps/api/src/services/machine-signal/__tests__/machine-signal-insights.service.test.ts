import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn(),
  settings: vi.fn(), sensors: vi.fn(), summaries: vi.fn(),
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { machineSignalDailyReport: {
  findMany: mocks.findMany, findFirst: mocks.findFirst, groupBy: mocks.groupBy,
} } }));
vi.mock('../machine-signal-settings.service.js', () => ({
  getMachineSignalSettings: mocks.settings, listMachineSignalSensors: mocks.sensors,
}));
vi.mock('../machine-signal-day-summary.cache.js', () => ({ loadSignalDaySummaries: mocks.summaries }));

import { buildSignalDaySummary } from '../machine-signal-insights.aggregate.js';
import {
  getMachineSignalDay, getMachineSignalRange, getMachineSignalTrend, getMachineSignalWorsening,
  listMachineSignalReportDates, listMachineSignalSensorsForAdmin, MACHINE_SIGNAL_RANGE_MAX_DAYS,
} from '../machine-signal-insights.service.js';
import type { MachineSignalSensorDto } from '../machine-signal-settings.service.js';
import { DEFAULT_SIGNAL_THRESHOLDS } from '../signal-metrics.js';

const date = (key: string) => new Date(`${key}T00:00:00.000Z`);
const sensor = (signalNo = 1, patch: Partial<MachineSignalSensorDto> = {}): MachineSignalSensorDto => ({
  signalNo, sourceMachineName: '機械', displayName: null, site: '第1工場', kind: 'MACHINE', hidden: false,
  categoryOverrides: {}, plannedStartMinute: null, plannedEndMinute: null, runningKw: null, idleKw: null, ...patch,
});
const sensors = [sensor(), sensor(2, { hidden: true }), sensor(3, { site: '第2工場' }), sensor(4, { site: null })];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({ nightStartMinute: 1_200, thresholds: DEFAULT_SIGNAL_THRESHOLDS });
  mocks.sensors.mockResolvedValue(sensors);
  mocks.summaries.mockResolvedValue([]);
  mocks.findMany.mockResolvedValue([]);
  mocks.groupBy.mockResolvedValue([]);
});

describe('listMachineSignalSensorsForAdmin', () => {
  it('reads only the grouped latest pairs and preserves patterns and compacted segments', async () => {
    mocks.groupBy.mockResolvedValue([
      { signalNo: 1, _max: { reportDate: date('2026-10-01') } },
      { signalNo: 3, _max: { reportDate: date('2026-09-30') } },
    ]);
    mocks.findMany.mockResolvedValue([
      { signalNo: 1, reportDate: date('2026-10-01'), dayStartMinute: 480,
        stateNames: ['稼働', '運転', '異常'], segments: [
          [0, 60, 2, 1, 1, 2], [60, 60, 1, 1, 2, 0], [120, 60, 1, 1, 2, 1], [180, 60, 2, 1, 1, 2],
        ] },
      { signalNo: 3, reportDate: date('2026-09-30'), dayStartMinute: 480, stateNames: [], segments: [] },
    ]);
    const result = await listMachineSignalSensorsForAdmin();
    expect(mocks.groupBy).toHaveBeenCalledWith({ by: ['signalNo'], _max: { reportDate: true } });
    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { OR: [
        { signalNo: 1, reportDate: date('2026-10-01') }, { signalNo: 3, reportDate: date('2026-09-30') },
      ] },
      select: { signalNo: true, reportDate: true, dayStartMinute: true, stateNames: true, segments: true },
    });
    expect(result[0]).toEqual({ ...sensors[0], latestReportDate: '2026-10-01',
      lampPatterns: [
        { pattern: '112', stateNames: ['稼働', '運転'], autoCategory: 'RUN' },
        { pattern: '211', stateNames: ['異常'], autoCategory: 'ALARM_STOP' },
      ], latestSegments: [[0, 60, 1], [60, 120, 0], [180, 60, 1]],
    });
    expect(result[1]).toEqual({ ...sensors[1], latestReportDate: null, lampPatterns: [], latestSegments: [] });
    expect(result[2]).toEqual({ ...sensors[2], latestReportDate: '2026-09-30', lampPatterns: [], latestSegments: [] });
  });

  it.each([{ groups: [] }, { groups: [{ signalNo: 1, _max: { reportDate: null } }] }])('skips report reads with no latest pair: %j', async ({ groups }) => {
    mocks.groupBy.mockResolvedValue(groups);
    const result = await listMachineSignalSensorsForAdmin();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(result).toEqual(sensors.map((entry) => ({ ...entry, latestReportDate: null, lampPatterns: [], latestSegments: [] })));
  });
});

describe('getMachineSignalDay', () => {
  it('reads segments for only the requested day and selected visible sensors', async () => {
    mocks.findFirst.mockResolvedValueOnce({ reportDate: date('2026-10-03') })
      .mockResolvedValueOnce({ reportDate: date('2026-09-30') })
      .mockResolvedValueOnce({ reportDate: date('2026-10-02') });
    mocks.findMany.mockResolvedValue([{ signalNo: 1, reportDate: date('2026-10-01'), dayStartMinute: 420,
      stateNames: ['稼働'], segments: [[0, 86_400, 1, 1, 2, 0]] }]);
    const result = await getMachineSignalDay({ date: '2026-10-01', site: '第1工場' });
    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { reportDate: date('2026-10-01'), signalNo: { in: [1] } }, orderBy: { reportDate: 'asc' },
      select: { signalNo: true, reportDate: true, dayStartMinute: true, stateNames: true, segments: true },
    });
    expect(result).toMatchObject({ reportDate: '2026-10-01', previousDate: '2026-09-30', nextDate: '2026-10-02',
      dayStartMinute: 420, sites: ['第1工場', '第2工場'], fleet: { machineCount: 1, runRatio: 1 },
      machines: [{ signalNo: 1, runSeconds: 86_400 }],
    });
    expect(result.fleet).not.toHaveProperty('worsening');
    expect(mocks.summaries).not.toHaveBeenCalled();
  });
});

describe('getMachineSignalRange', () => {
  it('rejects a reversed range before reading reports', async () => {
    await expect(getMachineSignalRange({ from: '2026-10-02', to: '2026-10-01' })).rejects.toMatchObject({
      statusCode: 400, message: '期間の始まりは終わりより前にしてください', code: 'MACHINE_SIGNAL_RANGE_INVALID',
    });
    expect(mocks.summaries).not.toHaveBeenCalled();
  });

  it('rejects 93 inclusive days', async () => {
    expect(MACHINE_SIGNAL_RANGE_MAX_DAYS).toBe(92);
    await expect(getMachineSignalRange({ from: '2026-07-01', to: '2026-10-01' })).rejects.toMatchObject({
      statusCode: 400, message: '期間は92日までにしてください', code: 'MACHINE_SIGNAL_RANGE_TOO_LONG',
    });
    expect(mocks.summaries).not.toHaveBeenCalled();
  });

  it('accepts 92 days and includes all visible sensors without a site filter', async () => {
    const result = await getMachineSignalRange({ from: '2026-07-02', to: '2026-10-01' });
    expect(result.dates).toHaveLength(92);
    expect(result.machines.map((machine) => machine.signalNo)).toEqual([1, 3, 4]);
    expect(mocks.summaries).toHaveBeenCalledWith({
      sensors: [sensors[0], sensors[2], sensors[3]], thresholds: DEFAULT_SIGNAL_THRESHOLDS,
      from: '2026-07-02', to: '2026-10-01',
    });
  });

  it('filters hidden sensors and site while retaining the visible site choices', async () => {
    const result = await getMachineSignalRange({ from: '2026-10-01', to: '2026-10-01', site: '第1工場' });
    expect(result.machines.map((machine) => machine.signalNo)).toEqual([1]);
    expect(result.sites).toEqual(['第1工場', '第2工場']);
    expect(result.dates).toEqual(['2026-10-01']);
    expect(mocks.summaries).toHaveBeenCalledWith({
      sensors: [sensors[0]], thresholds: DEFAULT_SIGNAL_THRESHOLDS, from: '2026-10-01', to: '2026-10-01',
    });
  });
});

describe('getMachineSignalTrend', () => {
  it('uses summaries and includes report days without records', async () => {
    mocks.summaries.mockResolvedValue([
      buildSignalDaySummary(sensor(), { signalNo: 1, reportDate: '2026-09-30', dayStartMinute: 480, stateNames: [], segments: [] }, DEFAULT_SIGNAL_THRESHOLDS),
      buildSignalDaySummary(sensor(), { signalNo: 1, reportDate: '2026-10-01', dayStartMinute: 480, stateNames: [], segments: [[0, 86_400, 1, 1, 2, 0]] }, DEFAULT_SIGNAL_THRESHOLDS),
    ]);
    expect(await getMachineSignalTrend({ signalNo: 1, endDate: '2026-10-01', days: 30 })).toEqual([
      { reportDate: '2026-09-30', runSeconds: 0, averageRunSeconds: 0, stopCount: 0, shortStopCount: 0, alarmCount: 0, alarmSeconds: 0 },
      { reportDate: '2026-10-01', runSeconds: 86_400, averageRunSeconds: 86_400, stopCount: 0, shortStopCount: 0, alarmCount: 0, alarmSeconds: 0 },
    ]);
    expect(mocks.summaries).toHaveBeenCalledWith({
      sensors: [sensors[0]], thresholds: DEFAULT_SIGNAL_THRESHOLDS, from: '2026-09-02', to: '2026-10-01',
    });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('returns no points for an unknown sensor', async () => {
    expect(await getMachineSignalTrend({ signalNo: 99, endDate: '2026-10-01', days: 30 })).toEqual([]);
    expect(mocks.summaries).not.toHaveBeenCalled();
  });
});

describe('getMachineSignalWorsening', () => {
  it('uses the inclusive 35 day window with the existing detection rules and site filter', async () => {
    const base = buildSignalDaySummary(sensor(), {
      signalNo: 1, reportDate: '2026-09-01', dayStartMinute: 480, stateNames: [], segments: [],
    }, DEFAULT_SIGNAL_THRESHOLDS);
    mocks.summaries.mockResolvedValue([
      ...Array.from({ length: 7 }, (_, index) => ({ ...base,
        reportDate: `2026-09-${String(index + 1).padStart(2, '0')}`, runSeconds: 36_000, averageRunSeconds: 3_600,
      })),
      ...['2026-09-25', '2026-09-26', '2026-10-01'].map((reportDate) => ({ ...base,
        reportDate, runSeconds: 36_000, averageRunSeconds: 1_800,
      })),
    ]);
    expect(await getMachineSignalWorsening({ date: '2026-10-01', site: '第1工場' })).toEqual([
      { signalNo: 1, kind: 'RUN_SHORTER', recent: 1_800, baseline: 3_600 },
    ]);
    expect(mocks.summaries).toHaveBeenCalledWith({
      sensors: [sensors[0]], thresholds: DEFAULT_SIGNAL_THRESHOLDS, from: '2026-08-28', to: '2026-10-01',
    });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('selects all visible sensors when no site is given', async () => {
    expect(await getMachineSignalWorsening({ date: '2026-10-01' })).toEqual([]);
    expect(mocks.summaries.mock.calls[0][0].sensors).toEqual([sensors[0], sensors[2], sensors[3]]);
  });
});

describe('listMachineSignalReportDates', () => {
  it('groups dates without reading segments and returns them in ascending order', async () => {
    mocks.groupBy.mockResolvedValue([{ reportDate: date('2026-10-01') }, { reportDate: date('2026-09-01') }]);
    expect(await listMachineSignalReportDates()).toEqual(['2026-09-01', '2026-10-01']);
    expect(mocks.groupBy).toHaveBeenCalledExactlyOnceWith({ by: ['reportDate'] });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
