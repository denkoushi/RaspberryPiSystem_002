import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  groupBy: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    machineSignalDailyReport: { findFirst: mocks.findFirst, groupBy: mocks.groupBy, count: mocks.count },
    machineSignalSensor: { updateMany: mocks.updateMany },
  },
}));
vi.mock('../../backup/backup-config.loader.js', () => ({ BackupConfigLoader: { load: mocks.loadConfig } }));
vi.mock('../machine-signal-gmail.scheduler.js', () => ({ MACHINE_SIGNAL_GMAIL_CRON: '47 * * * *' }));
vi.mock('../machine-signal-gmail-ingestion.service.js', () => ({
  hasGmailCredentials: (config: { storage?: { options?: { gmail?: { refreshToken?: string } } } }) =>
    Boolean(config.storage?.options?.gmail?.refreshToken),
}));

import { getMachineSignalAdminOverview } from '../machine-signal-admin.service.js';
import { updateMachineSignalSensorsBulk } from '../machine-signal-settings.service.js';

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe('getMachineSignalAdminOverview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the last sixty days up to today in Japan time, with gaps as zero', async () => {
    mocks.findFirst.mockResolvedValue({ reportDate: day('2026-10-01') });
    mocks.groupBy.mockResolvedValue([
      { reportDate: day('2026-10-01'), _count: { _all: 50 } },
      { reportDate: day('2026-09-29'), _count: { _all: 48 } },
    ]);
    mocks.count.mockResolvedValue(50);
    mocks.loadConfig.mockResolvedValue({
      csvImports: [{ id: 'machine-signal-gmail', schedule: '17 6 * * *', enabled: false }],
    });

    // 2026-10-01 16:30 UTC は、日本では 10/02 01:30。
    const overview = await getMachineSignalAdminOverview(new Date('2026-10-01T16:30:00.000Z'));

    expect(overview.coverage).toHaveLength(60);
    expect(overview.coverage[59]).toEqual({ date: '2026-10-02', count: 0 });
    expect(overview.coverage[58]).toEqual({ date: '2026-10-01', count: 50 });
    expect(overview.coverage[57]).toEqual({ date: '2026-09-30', count: 0 });
    expect(overview.coverage[56]).toEqual({ date: '2026-09-29', count: 48 });
    expect(overview).toMatchObject({
      latestReportDate: '2026-10-01',
      latestReportCount: 50,
      // CSV取込の一覧に行があれば、その時刻と有効・無効を出す。
      gmailSchedule: { schedule: '17 6 * * *', enabled: false },
    });
  });

  it('shows the built-in hourly check while the CSV import list has no row, off where Gmail is not connected', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.groupBy.mockResolvedValue([]);
    mocks.loadConfig.mockResolvedValue({ csvImports: [], storage: { options: {} } });

    const overview = await getMachineSignalAdminOverview(new Date('2026-10-02T03:00:00.000Z'));

    expect(overview).toMatchObject({
      latestReportDate: null,
      latestReportCount: 0,
      gmailSchedule: { schedule: '47 * * * *', enabled: false },
    });
    expect(mocks.count).not.toHaveBeenCalled();
  });
});

describe('updateMachineSignalSensorsBulk', () => {
  beforeEach(() => vi.clearAllMocks());

  it('changes only the fields that were passed', async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 });

    await expect(updateMachineSignalSensorsBulk([3, 6], { site: ' 三島工場 ', planned: null })).resolves.toBe(2);

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { signalNo: { in: [3, 6] } },
      data: { site: '三島工場', plannedStartMinute: null, plannedEndMinute: null },
    });
  });

  it('sets planned hours as a pair and clears the site with an empty value', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await updateMachineSignalSensorsBulk([8], { site: '', kind: 'ROBOT', hidden: true, planned: { startMinute: 480, endMinute: 1_200 } });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { signalNo: { in: [8] } },
      data: { site: null, kind: 'ROBOT', hidden: true, plannedStartMinute: 480, plannedEndMinute: 1_200 },
    });
  });

  it('refuses an empty change', async () => {
    await expect(updateMachineSignalSensorsBulk([8], {})).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
