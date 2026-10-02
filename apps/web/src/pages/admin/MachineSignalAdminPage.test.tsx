import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineSignalAdminPage } from './MachineSignalAdminPage';

import type { MachineSignalSensor } from '../../api/client';

const mocks = vi.hoisted(() => ({
  updateSensor: vi.fn(),
  updateBulk: vi.fn(),
  updateSettings: vi.fn(),
  runGmail: vi.fn(),
  upload: vi.fn(),
  invalidate: vi.fn()
}));

const HOUR = 3_600;
const sensor = (overrides: Partial<MachineSignalSensor>): MachineSignalSensor => ({
  signalNo: 39,
  sourceMachineName: 'N7',
  displayName: null,
  site: null,
  kind: 'MACHINE',
  hidden: false,
  plannedStartMinute: null,
  plannedEndMinute: null,
  runningKw: null,
  idleKw: null,
  categoryOverrides: {},
  latestReportDate: '2026-10-01',
  lampPatterns: [
    { pattern: '112', stateNames: ['設備稼働'], autoCategory: 'RUN' },
    { pattern: '122', stateNames: ['稼働中停止'], autoCategory: 'RUN' }
  ],
  latestSegments: [
    [0, 20 * HOUR, 0],
    [20 * HOUR, 4 * HOUR, 1]
  ],
  ...overrides
});

// 実際のフックと同じく、描画のたびに同じ data を返す。
const QUERIES = vi.hoisted(() => ({
  sensors: { data: [] as unknown[], isLoading: false },
  settings: {
    data: {
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
      updatedAt: null,
      updatedBy: null
    },
    dataUpdatedAt: 1,
    isError: false
  },
  overview: {
    data: {
      latestReportDate: '2026-10-01',
      latestReportCount: 50,
      coverage: [
        { date: '2026-09-30', count: 0 },
        { date: '2026-10-01', count: 50 }
      ],
      gmailSchedule: { schedule: '47 * * * *', enabled: true }
    }
  },
  runs: { data: [] as unknown[] }
}));

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  uploadMachineSignalReports: mocks.upload
}));

vi.mock('../../api/hooks', () => ({
  useMachineSignalSensors: () => QUERIES.sensors,
  useMachineSignalSettings: () => QUERIES.settings,
  useMachineSignalAdminOverview: () => QUERIES.overview,
  useMachineSignalImportRuns: () => QUERIES.runs,
  useUpdateMachineSignalSensor: () => ({ mutateAsync: mocks.updateSensor, isPending: false, error: null }),
  useUpdateMachineSignalSensorsBulk: () => ({ mutateAsync: mocks.updateBulk, isPending: false, error: null }),
  useUpdateMachineSignalSettings: () => ({ mutate: mocks.updateSettings, isPending: false, error: null }),
  useRunMachineSignalGmailImport: () => ({ mutate: mocks.runGmail, isPending: false }),
  useInvalidateMachineSignal: () => mocks.invalidate
}));

describe('MachineSignalAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    QUERIES.sensors.data = [
      sensor({}),
      sensor({ signalNo: 8, sourceMachineName: 'HCN4000', site: '三島工場' }),
      sensor({ signalNo: 5, sourceMachineName: 'MCR-A5C', latestSegments: [] })
    ];
  });

  it('shows the import status and every sensor, with the unset ones counted', () => {
    render(<MachineSignalAdminPage />);

    expect(screen.getAllByText('10/01').length).toBeGreaterThan(0);
    expect(screen.getByText('50台')).toBeInTheDocument();
    expect(screen.getByText('毎時 :47')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '直近2日のうち 1日を取り込み済み' })).toBeInTheDocument();
    const filters = within(screen.getByRole('group', { name: '絞り込み' }));
    expect(filters.getByRole('button', { name: /工場 未設定/ })).toHaveTextContent('2');
    expect(filters.getByRole('button', { name: /三島工場/ })).toHaveTextContent('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the editor for the row that was pressed and saves that sensor', async () => {
    mocks.updateSensor.mockResolvedValue(undefined);
    render(<MachineSignalAdminPage />);

    fireEvent.click(screen.getByRole('button', { name: /N7/ }));
    const editor = within(screen.getByRole('dialog', { name: 'センサーの設定' }));
    fireEvent.change(editor.getByLabelText('表示名'), { target: { value: 'N7（三島）' } });
    fireEvent.click(editor.getByRole('button', { name: '三島工場' }));
    fireEvent.click(editor.getByRole('button', { name: '時間を決める' }));
    fireEvent.change(editor.getByLabelText('稼働中の電力（kW）'), { target: { value: '15' } });
    fireEvent.click(within(editor.getByRole('group', { name: '稼働中停止 の区分' })).getByRole('button', { name: '停止' }));
    fireEvent.click(editor.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.updateSensor).toHaveBeenCalledWith({
        signalNo: 39,
        input: {
          displayName: 'N7（三島）',
          site: '三島工場',
          kind: 'MACHINE',
          hidden: false,
          plannedStartMinute: 480,
          plannedEndMinute: 1_200,
          runningKw: 15,
          idleKw: null,
          categoryOverrides: { '122': 'STOP' }
        }
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('保存しました');
  });

  it('sets only the pressed fields on every checked sensor', async () => {
    mocks.updateBulk.mockResolvedValue(2);
    render(<MachineSignalAdminPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'N7 をまとめて選ぶ' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'MCR-A5C をまとめて選ぶ' }));
    const editor = within(screen.getByRole('dialog', { name: 'センサーの設定' }));
    expect(editor.getByRole('heading')).toHaveTextContent('2台をまとめて設定');
    expect(editor.getByRole('button', { name: '保存' })).toBeDisabled();

    fireEvent.change(editor.getByLabelText('工場を追加'), { target: { value: '仙台三島' } });
    fireEvent.keyDown(editor.getByLabelText('工場を追加'), { key: 'Enter' });
    fireEvent.click(editor.getByRole('button', { name: 'ロボット' }));
    fireEvent.click(editor.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.updateBulk).toHaveBeenCalledWith({ signalNos: [39, 5], patch: { site: '仙台三島', kind: 'ROBOT' } })
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2台を保存しました'));
  });

  it('selects every sensor without a site in one press', () => {
    render(<MachineSignalAdminPage />);
    fireEvent.click(screen.getByRole('button', { name: '未設定をすべて選ぶ' }));
    expect(within(screen.getByRole('dialog')).getByRole('heading')).toHaveTextContent('2台をまとめて設定');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows how many sensors each hint catches and recounts when a threshold changes', () => {
    render(<MachineSignalAdminPage />);
    const good = screen.getByText('良好').closest('.rule') as HTMLElement;
    // N7 と HCN4000 は終日稼働。良好の下限16時間なら2台、届かない時間まで上げると0台。
    expect(good).toHaveTextContent('2台');
    fireEvent.change(screen.getByLabelText('良好 にする稼働の下限（時間）'), { target: { value: '25' } });
    expect(good).toHaveTextContent('0台');

    fireEvent.change(screen.getByLabelText('夜の開始'), { target: { value: '21:00' } });
    fireEvent.click(within(screen.getByText('判定の設定').closest('aside') as HTMLElement).getByRole('button', { name: '保存' }));
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { nightStartMinute: 1_260, thresholds: { ...QUERIES.settings.data.thresholds, goodRunMinSeconds: 90_000 } },
      expect.anything()
    );
  });

  it('uploads only the daily reports of the chosen folder, fifty at a time', async () => {
    mocks.upload.mockResolvedValue({ importedCount: 2, failedCount: 0, failures: [] });
    render(<MachineSignalAdminPage />);
    fireEvent.click(screen.getByRole('button', { name: '過去分を取り込む' }));
    const files = [
      new File(['a'], 'DailySummary_Signal1_20241001.csv'),
      new File(['b'], 'DailySummary_Signal2_20241001.csv'),
      new File(['c'], 'desktop.ini')
    ];

    fireEvent.change(screen.getByLabelText('取り込むフォルダ'), { target: { files } });

    await waitFor(() => expect(screen.getByText(/2 \/ 2 件/)).toHaveTextContent('取り込み 2 ・ 失敗 0 ・ 対象外 1'));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0][0]).toHaveLength(2);
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('checks Gmail on request', () => {
    render(<MachineSignalAdminPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Gmailを今すぐ確認' }));
    expect(mocks.runGmail).toHaveBeenCalled();
  });
});
