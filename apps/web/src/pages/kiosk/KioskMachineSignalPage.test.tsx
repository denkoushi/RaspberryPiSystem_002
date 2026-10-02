import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskMachineSignalPage } from './KioskMachineSignalPage';

import type { MachineSignalDay, MachineSignalMachineDay } from '../../api/client';

const mocks = vi.hoisted(() => ({ useDay: vi.fn(), useTrend: vi.fn() }));

vi.mock('../../api/hooks', () => ({
  useMachineSignalDay: mocks.useDay,
  useMachineSignalTrend: mocks.useTrend
}));

const HOUR = 3_600;
const LOSS = {
  normalRunSeconds: 0,
  runAlarmSeconds: 0,
  shortStopSeconds: 0,
  midStopSeconds: 0,
  longStopSeconds: 0,
  notStartedSeconds: 0,
  outsidePlanSeconds: 0,
  noRecordSeconds: 0
};

const machine = (overrides: Partial<MachineSignalMachineDay>): MachineSignalMachineDay => ({
  signalNo: 1,
  name: 'HCN4000',
  sourceMachineName: 'HCN4000',
  site: null,
  kind: 'MACHINE',
  hint: 'GOOD',
  hasRecord: true,
  timeline: [[0, 24 * HOUR, 0]],
  categorySeconds: [24 * HOUR, 0, 0, 0, 0, 0],
  runSeconds: 24 * HOUR,
  runBlockCount: 1,
  averageRunSeconds: 24 * HOUR,
  longestRunSeconds: 24 * HOUR,
  stopCount: 0,
  shortStopCount: 0,
  stopBuckets: [0, 1, 2, 3].map(() => ({ count: 0, seconds: 0 })),
  longestStops: [],
  alarmCount: 0,
  alarmSeconds: 0,
  loss: { ...LOSS, normalRunSeconds: 24 * HOUR },
  estimatedKwh: null,
  ...overrides
});

const stopped = machine({
  signalNo: 2,
  name: 'NHX5000',
  hint: 'ALARM',
  timeline: [
    [0, 8 * HOUR, 0],
    [8 * HOUR, 16 * HOUR, 3]
  ],
  categorySeconds: [8 * HOUR, 0, 0, 16 * HOUR, 0, 0],
  runSeconds: 8 * HOUR,
  averageRunSeconds: 8 * HOUR,
  longestRunSeconds: 8 * HOUR,
  stopCount: 1,
  stopBuckets: [
    { count: 0, seconds: 0 },
    { count: 0, seconds: 0 },
    { count: 0, seconds: 0 },
    { count: 1, seconds: 16 * HOUR }
  ],
  longestStops: [{ startSecond: 8 * HOUR, durationSeconds: 16 * HOUR, stateName: '異常停止' }],
  alarmCount: 1,
  alarmSeconds: 16 * HOUR,
  loss: { ...LOSS, normalRunSeconds: 8 * HOUR, longStopSeconds: 16 * HOUR }
});

const day = (overrides: Partial<MachineSignalDay> = {}): MachineSignalDay => ({
  reportDate: '2026-10-01',
  previousDate: '2026-09-30',
  nextDate: null,
  dayStartMinute: 480,
  nightStartMinute: 1_200,
  thresholds: {
    shortStopMaxSeconds: 300,
    longStopMinSeconds: 10_800,
    shortStopCountForHint: 10,
    alarmSecondsForHint: 1_800,
    alarmCountForHint: 10,
    barelyRanMaxSeconds: 3_600,
    goodRunMinSeconds: 57_600,
    worseningPercent: 30
  },
  sites: ['第1工場', '第2工場'],
  fleet: {
    machineCount: 2,
    runRatio: 32 / 48,
    loss: { ...LOSS, normalRunSeconds: 32 * HOUR, longStopSeconds: 16 * HOUR },
    runningBins: new Array(144).fill(1.5),
    dayAverage: 2,
    nightAverage: 1,
    hintCounts: { ALARM: 1, SHORT_STOPS: 0, LONG_STOP: 0, BARELY_RAN: 0, NONE: 0, NO_RECORD: 0, GOOD: 1 },
    estimatedKwh: null,
    topAlarm: [2],
    topShortStops: [],
    topLongStop: [2],
    worsening: [{ signalNo: 2, kind: 'RUN_SHORTER', baseline: 12 * HOUR, recent: 8 * HOUR }]
  },
  machines: [machine({}), stopped],
  ...overrides
});

describe('KioskMachineSignalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom には canvas の描画が無い。帯の描画は対象外なので、取得だけ空で返す。
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mocks.useTrend.mockReturnValue({ data: [] });
  });

  it('opens on the overview with the share of time running and where the rest went', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);

    expect(screen.getByRole('heading', { name: '設備稼働' })).toBeInTheDocument();
    expect(screen.getByText('10/1（木）')).toBeInTheDocument();
    expect(screen.getByText('67')).toBeInTheDocument();
    expect(screen.getByText('3時間超の停止')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '赤ランプが長い' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '悪くなってきた機械' })).toBeInTheDocument();
    expect(screen.getByText('12.0時間 → 8.0時間')).toBeInTheDocument();
  });

  it('jumps from a machine on the overview to its detail', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);

    const panel = screen.getByRole('heading', { name: '赤ランプが長い' }).closest('section') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: /NHX5000/ }));

    expect(screen.getByRole('heading', { name: /NHX5000/, level: 2 })).toBeInTheDocument();
    expect(screen.getByText('長い停止')).toBeInTheDocument();
    expect(screen.getByText('16:00')).toBeInTheDocument();
    expect(mocks.useTrend).toHaveBeenLastCalledWith({ signalNo: 2, endDate: '2026-10-01', days: 30 });
  });

  it('filters the machine list by hint', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);

    fireEvent.click(screen.getByRole('button', { name: '機械別' }));
    expect(screen.getAllByRole('img', { name: /の24時間$/ }).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(within(screen.getByRole('group', { name: '気づきで絞り込み' })).getByRole('button', { name: /良好/ }));

    expect(screen.queryByRole('button', { name: /NHX5000/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /HCN4000/, level: 2 })).toBeInTheDocument();
  });

  it('asks for the previous day and for one site', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);

    expect(screen.getByRole('button', { name: '次の日' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '前の日' }));
    expect(mocks.useDay).toHaveBeenLastCalledWith({ date: '2026-09-30', site: undefined });

    fireEvent.click(screen.getByRole('button', { name: '第2工場' }));
    expect(mocks.useDay).toHaveBeenLastCalledWith({ date: '2026-09-30', site: '第2工場' });
  });

  it('says so when no report has been imported yet', () => {
    mocks.useDay.mockReturnValue({ data: day({ reportDate: null, fleet: null, machines: [], sites: [] }), isError: false });
    render(<KioskMachineSignalPage />);
    expect(screen.getByText('日報がまだありません')).toBeInTheDocument();
  });

  it('shows an error when the day cannot be loaded', () => {
    mocks.useDay.mockReturnValue({ data: undefined, isError: true });
    render(<KioskMachineSignalPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした');
  });
});
