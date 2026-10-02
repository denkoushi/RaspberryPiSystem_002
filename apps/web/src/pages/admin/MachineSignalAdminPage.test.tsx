import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineSignalAdminPage } from './MachineSignalAdminPage';

import type { MachineSignalSensor } from '../../api/client';

const mocks = vi.hoisted(() => ({
  updateSensor: vi.fn(),
  updateSettings: vi.fn(),
  runGmail: vi.fn(),
  upload: vi.fn(),
  invalidate: vi.fn()
}));

const sensor: MachineSignalSensor = {
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
  ]
};

const THRESHOLDS = {
  shortStopMaxSeconds: 300,
  longStopMinSeconds: 10_800,
  shortStopCountForHint: 10,
  alarmSecondsForHint: 1_800,
  alarmCountForHint: 10,
  barelyRanMaxSeconds: 3_600,
  goodRunMinSeconds: 57_600,
  worseningPercent: 30
};

// 実際のフックと同じく、描画のたびに同じ data を返す（設定フォームの初期化が繰り返されないように）。
const SETTINGS_QUERY = vi.hoisted(() => ({
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
  }
}));

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  uploadMachineSignalReports: mocks.upload
}));

vi.mock('../../api/hooks', () => ({
  useMachineSignalSensors: () => ({ data: [sensor], isLoading: false }),
  useMachineSignalSettings: () => SETTINGS_QUERY,
  useMachineSignalImportRuns: () => ({ data: [] }),
  useUpdateMachineSignalSensor: () => ({ mutateAsync: mocks.updateSensor, isPending: false, error: null }),
  useUpdateMachineSignalSettings: () => ({ mutate: mocks.updateSettings, isPending: false, isSuccess: false, error: null }),
  useRunMachineSignalGmailImport: () => ({ mutate: mocks.runGmail, isPending: false, data: undefined, error: null }),
  useInvalidateMachineSignal: () => mocks.invalidate
}));

describe('MachineSignalAdminPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a sensor with its site, planned hours, power and lamp override', async () => {
    mocks.updateSensor.mockResolvedValue(undefined);
    render(<MachineSignalAdminPage />);

    fireEvent.click(screen.getByRole('button', { name: '編集' }));
    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: 'N7（第1）' } });
    fireEvent.change(screen.getByLabelText('工場'), { target: { value: '第1工場' } });
    fireEvent.change(screen.getByLabelText('稼働予定 開始'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('稼働予定 終了'), { target: { value: '20:00' } });
    fireEvent.change(screen.getByLabelText('稼働中の電力（kW）'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('赤消 黄点灯 緑点灯 の区分'), { target: { value: 'STOP' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);

    await waitFor(() =>
      expect(mocks.updateSensor).toHaveBeenCalledWith({
        signalNo: 39,
        input: {
          displayName: 'N7（第1）',
          site: '第1工場',
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
  });

  it('shows thresholds in minutes and saves them in seconds', () => {
    render(<MachineSignalAdminPage />);

    const shortStop = screen.getByLabelText('短い停止の上限（分）');
    expect(shortStop).toHaveValue('5');
    fireEvent.change(shortStop, { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('夜の開始'), { target: { value: '21:00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      nightStartMinute: 1_260,
      thresholds: { ...THRESHOLDS, shortStopMaxSeconds: 600 }
    });
  });

  it('uploads only daily report files from the chosen folder and reports the result', async () => {
    mocks.upload.mockResolvedValue({ importedCount: 2, failedCount: 0, failures: [] });
    render(<MachineSignalAdminPage />);
    const files = [
      new File(['a'], 'DailySummary_Signal1_20241001.csv'),
      new File(['b'], 'DailySummary_Signal2_20241001.csv'),
      new File(['c'], 'desktop.ini')
    ];

    fireEvent.change(screen.getByLabelText('フォルダを選ぶ（日付フォルダをまとめて）'), { target: { files } });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 / 2 件 ・ 取り込み 2 ・ 失敗 0 ・ 対象外 1'));
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
