import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => ({
  getDay: vi.fn(),
  getWorsening: vi.fn(),
  getRange: vi.fn(),
  listDates: vi.fn(),
  getTrend: vi.fn(),
  listSensorsForAdmin: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updateSensor: vi.fn(),
  updateSensorsBulk: vi.fn(),
  getOverview: vi.fn(),
  importFiles: vi.fn(),
  listRuns: vi.fn(),
  loadConfig: vi.fn(),
  runOnce: vi.fn(),
  hasGmailCredentials: vi.fn(),
}));

vi.mock('../../../services/machine-signal/machine-signal-insights.service.js', () => ({
  getMachineSignalDay: mocks.getDay,
  getMachineSignalWorsening: mocks.getWorsening,
  getMachineSignalRange: mocks.getRange,
  listMachineSignalReportDates: mocks.listDates,
  getMachineSignalTrend: mocks.getTrend,
  listMachineSignalSensorsForAdmin: mocks.listSensorsForAdmin,
}));
vi.mock('../../../services/machine-signal/machine-signal-settings.service.js', () => ({
  MACHINE_SIGNAL_SENSOR_KINDS: ['MACHINE', 'ROBOT', 'LINE', 'OTHER'],
  getMachineSignalSettings: mocks.getSettings,
  updateMachineSignalSettings: mocks.updateSettings,
  updateMachineSignalSensor: mocks.updateSensor,
  updateMachineSignalSensorsBulk: mocks.updateSensorsBulk,
}));
vi.mock('../../../services/machine-signal/machine-signal-admin.service.js', () => ({
  getMachineSignalAdminOverview: mocks.getOverview,
}));
vi.mock('../../../services/machine-signal/signal-report-import.service.js', () => ({
  importSignalReportFiles: mocks.importFiles,
  listSignalImportRuns: mocks.listRuns,
}));
vi.mock('../../../services/machine-signal/machine-signal-gmail-ingestion.service.js', () => ({
  getMachineSignalGmailIngestionService: () => ({ runOnce: mocks.runOnce }),
  hasGmailCredentials: mocks.hasGmailCredentials,
}));
vi.mock('../../../services/backup/backup-config.loader.js', () => ({
  BackupConfigLoader: { load: mocks.loadConfig },
}));

import { registerMachineSignalRoutes } from '../index.js';

const THRESHOLDS = {
  shortStopMaxSeconds: 300,
  longStopMinSeconds: 10_800,
  shortStopCountForHint: 10,
  alarmSecondsForHint: 1_800,
  alarmCountForHint: 10,
  barelyRanMaxSeconds: 3_600,
  goodRunMinSeconds: 57_600,
  worseningPercent: 30,
};

const SENSOR_BODY = {
  displayName: '1号機',
  site: '第1工場',
  kind: 'MACHINE',
  hidden: false,
  plannedStartMinute: 480,
  plannedEndMinute: 1_020,
  runningKw: 15,
  idleKw: null,
  categoryOverrides: { '122': 'STOP' },
};

async function createApp(options: { manageAllowed?: boolean } = {}) {
  const app = Fastify();
  await app.register(multipart);
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof ZodError ? 400 : ((error as { statusCode?: number }).statusCode ?? 500);
    void reply.code(status).send({ message: error.message });
  });
  const allowView = vi.fn(async () => undefined);
  const canManage = vi.fn(async () => {
    if (options.manageAllowed === false) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  });
  registerMachineSignalRoutes(app, { allowView, canManage });
  await app.ready();
  return { app, allowView, canManage };
}

function multipartBody(files: Array<{ name: string; content: string }>) {
  const boundary = '----machine-signal-test';
  const body = files
    .map(
      (file) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\n` +
        `Content-Type: text/csv\r\n\r\n${file.content}\r\n`
    )
    .join('');
  return { payload: `${body}--${boundary}--\r\n`, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('machine signal routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the day for a kiosk and passes the date and site through', async () => {
    mocks.getDay.mockResolvedValue({ reportDate: '2026-10-01', machines: [] });
    const { app, allowView } = await createApp();

    const response = await app.inject({ method: 'GET', url: '/machine-signal/day?date=2026-10-01&site=%E7%AC%AC1%E5%B7%A5%E5%A0%B4' });

    expect(response.statusCode).toBe(200);
    expect(allowView).toHaveBeenCalled();
    expect(mocks.getDay).toHaveBeenCalledWith({ date: '2026-10-01', site: '第1工場' });
  });

  it('rejects a malformed date', async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: 'GET', url: '/machine-signal/day?date=2026-1-1' });
    expect(response.statusCode).toBe(400);
    expect(mocks.getDay).not.toHaveBeenCalled();
  });

  it('reads the trend of one sensor for an allowed period only', async () => {
    mocks.getTrend.mockResolvedValue([]);
    const { app } = await createApp();

    const ok = await app.inject({ method: 'GET', url: '/machine-signal/sensors/8/trend?endDate=2026-10-01&days=90' });
    const bad = await app.inject({ method: 'GET', url: '/machine-signal/sensors/8/trend?endDate=2026-10-01&days=7' });

    expect(ok.statusCode).toBe(200);
    expect(mocks.getTrend).toHaveBeenCalledWith({ signalNo: 8, endDate: '2026-10-01', days: 90 });
    expect(bad.statusCode).toBe(400);
  });

  it('returns worsening for a date and site through allowView', async () => {
    const worsening = [{ signalNo: 1, kind: 'RUN_SHORTER', recent: 1_800, baseline: 3_600 }];
    mocks.getWorsening.mockResolvedValue(worsening);
    const { app, allowView, canManage } = await createApp();
    const response = await app.inject({ method: 'GET', url: '/machine-signal/worsening?date=2026-10-01&site=factory' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ worsening });
    expect(mocks.getWorsening).toHaveBeenCalledWith({ date: '2026-10-01', site: 'factory' });
    expect(allowView).toHaveBeenCalledOnce();
    expect(canManage).not.toHaveBeenCalled();
  });

  it('returns a range for required dates and optional site through allowView', async () => {
    const range = { from: '2026-09-01', to: '2026-10-01', dates: [], machines: [], fleet: {} };
    mocks.getRange.mockResolvedValue(range);
    const { app, allowView, canManage } = await createApp();
    const response = await app.inject({ method: 'GET', url: '/machine-signal/range?from=2026-09-01&to=2026-10-01&site=factory' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(range);
    expect(mocks.getRange).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-10-01', site: 'factory' });
    expect(allowView).toHaveBeenCalledOnce();
    expect(canManage).not.toHaveBeenCalled();
  });

  it('returns report dates through allowView', async () => {
    mocks.listDates.mockResolvedValue(['2026-09-01', '2026-10-01']);
    const { app, allowView, canManage } = await createApp();
    const response = await app.inject({ method: 'GET', url: '/machine-signal/dates' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ dates: ['2026-09-01', '2026-10-01'] });
    expect(mocks.listDates).toHaveBeenCalledExactlyOnceWith();
    expect(allowView).toHaveBeenCalledOnce();
    expect(canManage).not.toHaveBeenCalled();
  });

  it.each([
    '/machine-signal/worsening',
    '/machine-signal/worsening?date=2026-1-1',
    '/machine-signal/range',
    '/machine-signal/range?from=2026-10-01',
    '/machine-signal/range?to=2026-10-01',
    '/machine-signal/range?from=2026-1-1&to=2026-10-01',
    '/machine-signal/range?from=2026-10-01&to=invalid',
  ])('rejects missing or malformed required dates: %s', async (url) => {
    const { app, allowView } = await createApp();
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(400);
    expect(mocks.getWorsening).not.toHaveBeenCalled();
    expect(mocks.getRange).not.toHaveBeenCalled();
    expect(allowView).toHaveBeenCalledOnce();
  });

  it('keeps settings and sensors behind the manager role', async () => {
    const { app } = await createApp({ manageAllowed: false });
    for (const [method, url] of [
      ['GET', '/machine-signal/settings'],
      ['PUT', '/machine-signal/settings'],
      ['GET', '/machine-signal/sensors'],
      ['PUT', '/machine-signal/sensors/8'],
      ['PUT', '/machine-signal/sensors/bulk'],
      ['GET', '/machine-signal/admin/overview'],
      ['GET', '/machine-signal/import-runs'],
      ['POST', '/machine-signal/import'],
      ['POST', '/machine-signal/gmail-import/run'],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.importFiles).not.toHaveBeenCalled();
  });

  it('saves the screen settings', async () => {
    mocks.updateSettings.mockResolvedValue({ nightStartMinute: 1_260, thresholds: THRESHOLDS });
    const { app } = await createApp();

    const response = await app.inject({
      method: 'PUT',
      url: '/machine-signal/settings',
      payload: { nightStartMinute: 1_260, thresholds: THRESHOLDS },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ nightStartMinute: 1_260, thresholds: THRESHOLDS }, null);
  });

  it('rejects settings with a missing threshold', async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/machine-signal/settings',
      payload: { nightStartMinute: 1_260, thresholds: { ...THRESHOLDS, worseningPercent: undefined } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('saves a sensor and rejects an unknown lamp code or category', async () => {
    mocks.updateSensor.mockResolvedValue({ signalNo: 8, ...SENSOR_BODY });
    const { app } = await createApp();

    const ok = await app.inject({ method: 'PUT', url: '/machine-signal/sensors/8', payload: SENSOR_BODY });
    const badPattern = await app.inject({
      method: 'PUT',
      url: '/machine-signal/sensors/8',
      payload: { ...SENSOR_BODY, categoryOverrides: { '322': 'STOP' } },
    });
    const badCategory = await app.inject({
      method: 'PUT',
      url: '/machine-signal/sensors/8',
      payload: { ...SENSOR_BODY, categoryOverrides: { '122': 'BROKEN' } },
    });

    expect(ok.statusCode).toBe(200);
    expect(mocks.updateSensor).toHaveBeenCalledWith(8, SENSOR_BODY);
    expect(badPattern.statusCode).toBe(400);
    expect(badCategory.statusCode).toBe(400);
  });

  it('sets only the given fields on many sensors at once', async () => {
    mocks.updateSensorsBulk.mockResolvedValue(3);
    const { app } = await createApp();

    const ok = await app.inject({
      method: 'PUT',
      url: '/machine-signal/sensors/bulk',
      payload: { signalNos: [3, 6, 46], patch: { site: '三島工場', planned: null } },
    });
    const empty = await app.inject({
      method: 'PUT',
      url: '/machine-signal/sensors/bulk',
      payload: { signalNos: [], patch: { site: '三島工場' } },
    });

    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ updated: 3 });
    // 「bulk」がセンサー番号として解釈されないこと。
    expect(mocks.updateSensor).not.toHaveBeenCalled();
    expect(mocks.updateSensorsBulk).toHaveBeenCalledWith([3, 6, 46], { site: '三島工場', planned: null });
    expect(empty.statusCode).toBe(400);
  });

  it('returns the import overview for the admin page', async () => {
    mocks.getOverview.mockResolvedValue({ latestReportDate: '2026-10-01', latestReportCount: 50, coverage: [], gmailSchedule: null });
    const { app } = await createApp();
    const response = await app.inject({ method: 'GET', url: '/machine-signal/admin/overview' });
    expect(response.json().overview.latestReportCount).toBe(50);
  });

  it('imports more files in one upload than the app-wide default of ten', async () => {
    mocks.importFiles.mockResolvedValue({ runId: 'run-1', importedCount: 12 });
    const { app } = await createApp();
    const files = Array.from({ length: 12 }, (_, index) => ({
      name: `2026-10-01/DailySummary_Signal${index + 1}_20261001.csv`,
      content: 'x',
    }));

    const response = await app.inject({ method: 'POST', url: '/machine-signal/import', ...multipartBody(files) });

    expect(response.statusCode).toBe(200);
    const [received, options] = mocks.importFiles.mock.calls[0];
    expect(received).toHaveLength(12);
    // フォルダ選択で付いたパスは受信時に落ち、ファイル名だけが残る。
    expect(received[0]).toEqual({ fileName: 'DailySummary_Signal1_20261001.csv', content: Buffer.from('x') });
    expect(options).toEqual({ source: 'UPLOAD' });
  });

  it('rejects an upload without files', async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: 'POST', url: '/machine-signal/import', ...multipartBody([]) });
    expect(response.statusCode).toBe(400);
    expect(mocks.importFiles).not.toHaveBeenCalled();
  });

  it('refuses a manual Gmail import while Gmail is not connected', async () => {
    mocks.loadConfig.mockResolvedValue({});
    mocks.hasGmailCredentials.mockReturnValue(false);
    const { app } = await createApp();

    const response = await app.inject({ method: 'POST', url: '/machine-signal/gmail-import/run' });

    expect(response.statusCode).toBe(409);
    expect(mocks.runOnce).not.toHaveBeenCalled();
  });

  it('runs a manual Gmail import that may wait for the Gmail quota', async () => {
    const config = { storage: {} };
    mocks.loadConfig.mockResolvedValue(config);
    mocks.hasGmailCredentials.mockReturnValue(true);
    mocks.runOnce.mockResolvedValue({ scanned: 1, processed: 1, skipped: 0, runs: [] });
    const { app } = await createApp();

    const response = await app.inject({ method: 'POST', url: '/machine-signal/gmail-import/run' });

    expect(response.statusCode).toBe(200);
    expect(mocks.runOnce).toHaveBeenCalledWith({ config, allowWait: true });
  });
});
