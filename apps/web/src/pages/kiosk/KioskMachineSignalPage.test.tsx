import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskMachineSignalPage } from './KioskMachineSignalPage';

import type { MachineSignalDay, MachineSignalMachineDay, MachineSignalRange } from '../../api/client';

const mocks = vi.hoisted(() => ({ useDay: vi.fn(), useTrend: vi.fn(), useRange: vi.fn(), useDates: vi.fn(), useWorsening: vi.fn() }));

vi.mock('../../api/hooks', () => ({
  useMachineSignalDay: mocks.useDay,
  useMachineSignalTrend: mocks.useTrend,
  useMachineSignalRange: mocks.useRange,
  useMachineSignalReportDates: mocks.useDates,
  useMachineSignalWorsening: mocks.useWorsening
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
    topLongStop: [2]
  },
  machines: [machine({}), stopped],
  ...overrides
});

const range = (): MachineSignalRange => ({
  from: '2026-09-29', to: '2026-10-01', dates: ['2026-09-29', '2026-09-30', '2026-10-01'],
  thresholds: day().thresholds, sites: day().sites,
  fleet: {
    machineCount: 2, dayCount: 3, runRatio: 0.25, loss: { ...LOSS, normalRunSeconds: 36 * HOUR },
    dailyRunRatio: [0, 0.25, 0.5], hintDayCounts: day().fleet!.hintCounts, estimatedKwh: 100,
    topAlarm: [2], topShortStops: [2], topLongStop: [2]
  },
  machines: day().machines.map((item) => ({
    signalNo: item.signalNo, name: item.name, sourceMachineName: item.sourceMachineName, site: item.site, kind: item.kind,
    recordDays: 2, runSeconds: item.runSeconds * 2, averageRunSecondsPerDay: item.runSeconds * 2 / 3,
    stopCount: item.stopCount * 2, shortStopCount: item.shortStopCount * 2,
    alarmCount: item.alarmCount * 2, alarmSeconds: item.alarmSeconds * 2,
    longestStop: item.longestStops[0] ? { ...item.longestStops[0], reportDate: '2026-09-30' } : null,
    loss: item.loss, estimatedKwh: null,
    days: [null, { runSeconds: item.runSeconds, hint: item.hint }, { runSeconds: item.runSeconds, hint: item.hint }]
  }))
});

describe('KioskMachineSignalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.useRange.mockReturnValue({ data: range(), isError: false });
    mocks.useDates.mockReturnValue({ data: ['2026-09-29', '2026-09-30', '2026-10-01'] });
    mocks.useWorsening.mockReturnValue({ data: [{ signalNo: 2, kind: 'RUN_SHORTER', baseline: 12 * HOUR, recent: 8 * HOUR }] });
    // jsdom には canvas の描画が無い。帯の描画は対象外なので、取得だけ空で返す。
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mocks.useTrend.mockReturnValue({ data: [] });
  });

  it('opens on the overview with the share of time running and where the rest went', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);

    expect(screen.getByRole('heading', { name: '設備稼働' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10/01（木）' })).toBeInTheDocument();
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
  it('selects a reported day from the calendar and returns to latest', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);
    expect(screen.queryByRole('button', { name: '最新' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '10/01（木）' }));
    const calendar = screen.getByRole('dialog', { name: '日付を選ぶ' });
    expect(within(calendar).getByRole('button', { name: '10月2日（日報なし）' })).toBeDisabled();
    fireEvent.click(within(calendar).getByRole('button', { name: '前の月' }));
    fireEvent.click(within(calendar).getByRole('button', { name: '9月30日' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.useDay).toHaveBeenLastCalledWith({ date: '2026-09-30', site: undefined });
    fireEvent.click(screen.getByRole('button', { name: '最新' }));
    expect(mocks.useDay).toHaveBeenLastCalledWith({ date: undefined, site: undefined });
    expect(mocks.useRange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('button', { name: '最新' })).not.toBeInTheDocument();
  });

  it('selects a reverse range and disables day navigation while rendering range data', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);
    fireEvent.click(screen.getByRole('button', { name: '10/01（木）' }));
    const calendar = screen.getByRole('dialog');
    fireEvent.click(within(calendar).getByRole('button', { name: '期間' }));
    expect(screen.getByText('始まりの日を選ぶ')).toBeInTheDocument();
    fireEvent.click(within(calendar).getByRole('button', { name: '10月1日' }));
    expect(screen.getByText('終わりの日を選ぶ')).toBeInTheDocument();
    fireEvent.click(within(calendar).getByRole('button', { name: '前の月' }));
    fireEvent.click(within(calendar).getByRole('button', { name: '9月29日' }));
    expect(mocks.useRange).toHaveBeenLastCalledWith({ from: '2026-09-29', to: '2026-10-01', site: undefined });
    expect(screen.getByRole('button', { name: '9/29〜10/1（3日）' })).toBeInTheDocument();
    expect(screen.getByText('2台 × 3日のうち稼働 ・ 推定 100 kWh')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '日ごとの稼働' }).firstElementChild).toHaveStyle({ height: '0%' });
    expect(screen.getByRole('button', { name: '前の日' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '次の日' })).toBeDisabled();
    expect(mocks.useWorsening).toHaveBeenLastCalledWith({ date: null, site: undefined });
    fireEvent.click(screen.getByRole('button', { name: '機械別' }));
    const filters = screen.getByRole('group', { name: '気づきで絞り込み' });
    expect(within(filters).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: '最長の停止' })).toBeInTheDocument();
    expect(screen.getByText('記録のある日')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /の日ごとの稼働/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '第2工場' }));
    expect(mocks.useRange).toHaveBeenLastCalledWith({ from: '2026-09-29', to: '2026-10-01', site: '第2工場' });
    fireEvent.click(screen.getByRole('button', { name: '最新' }));
    expect(screen.queryByRole('heading', { name: '最長の停止' })).not.toBeInTheDocument();
    expect(screen.getByText('長い停止')).toBeInTheDocument();
  });

  it('selects presets using the last reported day and treats equal endpoints as a day', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);
    fireEvent.click(screen.getByRole('button', { name: '10/01（木）' }));
    fireEvent.click(screen.getByRole('button', { name: '直近30日' }));
    expect(mocks.useRange).toHaveBeenLastCalledWith({ from: '2026-09-02', to: '2026-10-01', site: undefined });
    fireEvent.click(screen.getByRole('button', { name: '9/2〜10/1（30日）' }));
    fireEvent.click(screen.getByRole('button', { name: '今月' }));
    expect(mocks.useDay).toHaveBeenLastCalledWith({ date: '2026-10-01', site: undefined });
    expect(mocks.useRange).toHaveBeenLastCalledWith(null);
  });

  it('discards a pending range on Escape or an outside click', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: '10/01（木）' }));
    open();
    fireEvent.click(screen.getByRole('button', { name: '期間' }));
    fireEvent.click(screen.getByRole('button', { name: '10月1日' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    fireEvent.click(screen.getByRole('button', { name: '期間' }));
    expect(screen.getByText('始まりの日を選ぶ')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('heading', { name: '設備稼働' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.useDay).toHaveBeenLastCalledWith({ date: undefined, site: undefined });
  });

  it('disables reported endpoints more than 92 days from the first click', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    mocks.useDates.mockReturnValue({ data: ['2026-07-01', '2026-07-02', '2026-10-01'] });
    render(<KioskMachineSignalPage />);
    fireEvent.click(screen.getByRole('button', { name: '10/01（木）' }));
    fireEvent.click(screen.getByRole('button', { name: '期間' }));
    fireEvent.click(screen.getByRole('button', { name: '10月1日' }));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: '前の月' }));
    expect(screen.getByRole('button', { name: '7月1日' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '7月2日' })).toBeEnabled();
  });

  it('toggles pins without selecting another detail, sorts them first and filters exclusively', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);
    fireEvent.click(screen.getByRole('button', { name: '機械別' }));
    fireEvent.click(screen.getByRole('button', { name: /HCN4000.*の24時間/ }));
    expect(screen.getByRole('heading', { name: /HCN4000/, level: 2 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'NHX5000 をピン留めする' }));
    expect(screen.getByRole('heading', { name: /HCN4000/, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NHX5000 をピン留めから外す' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('machine-signal-pins')).toBe('[2]');
    fireEvent.click(screen.getByRole('button', { name: 'HCN4000 をピン留めする' }));
    fireEvent.click(screen.getByRole('button', { name: 'NHX5000 をピン留めから外す' }));
    expect(screen.getAllByRole('button', { name: /をピン留め/ })[0]).toHaveAccessibleName('HCN4000 をピン留めから外す');
    const filters = screen.getByRole('group', { name: '気づきで絞り込み' });
    fireEvent.click(within(filters).getByRole('button', { name: /ピン留め 1/ }));
    expect(screen.queryByRole('button', { name: 'NHX5000 をピン留めする' })).not.toBeInTheDocument();
    expect(within(filters).getAllByRole('button', { pressed: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'HCN4000 をピン留めから外す' }));
    expect(screen.getByText('ピン留めした機械がありません')).toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: /すべて/ }));
    expect(screen.getByRole('button', { name: 'NHX5000 をピン留めする' })).toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: /良好/ }));
    expect(within(filters).getByRole('button', { name: /ピン留め/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('filters and toggles range pins without changing the fleet aggregation', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    render(<KioskMachineSignalPage />);
    fireEvent.click(screen.getByRole('button', { name: '10/01（木）' }));
    fireEvent.click(screen.getByRole('button', { name: '直近7日' }));
    fireEvent.click(screen.getByRole('button', { name: '機械別' }));
    fireEvent.click(screen.getByRole('button', { name: 'NHX5000 をピン留めする' }));
    expect(screen.getByRole('heading', { name: 'HCN4000' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ピン留め 1/ }));
    expect(screen.getByRole('heading', { name: 'NHX5000' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'HCN4000 をピン留めする' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'NHX5000 をピン留めから外す' }));
    expect(screen.getByText('ピン留めした機械がありません')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全体' }));
    expect(screen.getByText('2台 × 3日のうち稼働 ・ 推定 100 kWh')).toBeInTheDocument();
  });

  it('requests worsening separately for the displayed report and hides empty or loading results', () => {
    mocks.useDay.mockReturnValue({ data: day(), isError: false });
    mocks.useWorsening.mockReturnValue({ data: undefined });
    const { rerender } = render(<KioskMachineSignalPage />);
    expect(mocks.useWorsening).toHaveBeenLastCalledWith({ date: '2026-10-01', site: undefined });
    expect(screen.queryByRole('heading', { name: '悪くなってきた機械' })).not.toBeInTheDocument();
    mocks.useWorsening.mockReturnValue({ data: [] });
    rerender(<KioskMachineSignalPage />);
    expect(screen.queryByRole('heading', { name: '悪くなってきた機械' })).not.toBeInTheDocument();
  });

});
