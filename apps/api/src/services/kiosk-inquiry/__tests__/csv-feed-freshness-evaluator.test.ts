import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dashboards: vi.fn(), query: vi.fn(), state: vi.fn(), upsert: vi.fn(),
  config: vi.fn(), read: vi.fn(), deliver: vi.fn(), warn: vi.fn() }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  csvDashboard: { findMany: mocks.dashboards }, $queryRaw: mocks.query,
  csvFeedFreshnessState: { findUnique: mocks.state, upsert: mocks.upsert }
} }));
vi.mock('../system-notice.service.js', () => ({ deliverSystemNotice: mocks.deliver }));
vi.mock('../../imports/fkojunst-import-schedule.ensure.js', () => ({ loadBackupConfigWithFkojunstImportScheduleEnsured: mocks.config }));
vi.mock('../../file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ root: '/storage', store: { read: mocks.read } }) }));
import { CSV_FEED_FROZEN_DAYS, CSV_FEED_INTERVAL_SAMPLE, evaluateCsvFeedFreshness, getCsvFeedFreshnessEvaluator } from '../csv-feed-freshness-evaluator.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-21T00:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const dashboard = { id: 'feed', name: '在庫', gmailSubjectPattern: '在庫一覧' };
const run = (id: string, days: number) => ({ id, runAt: ago(days), csvFilePath: `/storage/csv-dashboards/feed/raw/${id}.csv` });
const saved = (days = 10) => ({ csvDashboardId: 'feed', lastComparedRunId: 'before', lastComparedRunAt: ago(1), lastContentChangedAt: ago(days) });
function history(runs: ReturnType<typeof run>[], predecessor?: ReturnType<typeof run>) {
  mocks.query.mockResolvedValueOnce([...runs].reverse().slice(0, CSV_FEED_INTERVAL_SAMPLE + 1))
    .mockResolvedValueOnce(runs).mockResolvedValueOnce(predecessor ? [predecessor] : []);
}
function files(contents: Record<string, string | Buffer>) {
  mocks.read.mockImplementation(async (key: string) => {
    const id = key.split('/').at(-1)!.replace(/\.csv$/, '');
    if (!(id in contents)) throw new Error('file unavailable');
    return Buffer.isBuffer(contents[id]) ? contents[id] : Buffer.from(contents[id], 'latin1');
  });
}
function notice(signal: string, state: string) {
  expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: `csv-feed:feed:${signal}`, state }), now);
}
function noNotice(signal: string) {
  expect(mocks.deliver.mock.calls.some(([entry]) => entry.key.endsWith(`:${signal}`))).toBe(false);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  mocks.config.mockResolvedValue({ config: { csvImports: [{ enabled: true, targets: [{ type: 'csvDashboards', source: 'feed' }] }] } });
  mocks.dashboards.mockResolvedValue([dashboard]);
  mocks.query.mockResolvedValue([]);
  mocks.state.mockResolvedValue(null);
  mocks.read.mockResolvedValue(Buffer.from('header\na\n'));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('CSV feed freshness evaluator', () => {
  it('opens a missing feed using median intervals and the subject label', async () => {
    mocks.query.mockResolvedValueOnce([run('c', 4), run('b', 5), run('a', 6)]);
    await evaluateCsvFeedFreshness(now);
    expect(mocks.deliver).toHaveBeenCalledWith({ key: 'csv-feed:feed:missing', title: 'CSV取込 在庫一覧', state: 'open',
      body: '「在庫一覧」のCSVが 4日 届いていません。メールで送っている自動フロー（Power Automate）が止まっていないか確認してください。' }, now);
    const query = mocks.query.mock.calls[0][0];
    expect(query.text).toContain('COALESCE("sourceReceivedAt", "completedAt", "startedAt")');
    expect(query.text).toContain('"status" = \'COMPLETED\'');
    expect(query.values).toEqual(['feed', CSV_FEED_INTERVAL_SAMPLE + 1]);
  });
  it.each([0, 3, 3 + 1 / DAY])('uses a strict missing threshold at age %s days', async (days) => {
    mocks.query.mockResolvedValueOnce([run('c', days), run('b', days + 1), run('a', days + 2)]);
    await evaluateCsvFeedFreshness(now);
    notice('missing', days > 3 ? 'open' : 'recovered');
  });
  it('recovers a missing notice when arrivals resume and falls back to the name', async () => {
    mocks.query.mockResolvedValueOnce([run('c', 4), run('b', 5), run('a', 6)]);
    await evaluateCsvFeedFreshness(now);
    notice('missing', 'open');
    mocks.deliver.mockClear();
    mocks.dashboards.mockResolvedValue([{ ...dashboard, gmailSubjectPattern: null }]);
    mocks.query.mockResolvedValueOnce([run('d', 0), run('c', 4), run('b', 5), run('a', 6)]);
    await evaluateCsvFeedFreshness(now);
    notice('missing', 'recovered');
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ title: 'CSV取込 在庫' }), now);
  });
  it('uses twice the median for slower feeds, averaging the two middle intervals', async () => {
    // Intervals 7, 1, 5, 3 => median 4, threshold 8 days.
    mocks.query.mockResolvedValueOnce([run('e', 7), run('d', 14), run('c', 15), run('b', 20), run('a', 23)]);
    await evaluateCsvFeedFreshness(now);
    notice('missing', 'recovered');
  });
  it.each([0, 1, 2])('skips missing with only %s runs', async (count) => {
    mocks.query.mockResolvedValueOnce(Array.from({ length: count }, (_, i) => run(String(i), 10 + i)));
    await evaluateCsvFeedFreshness(now);
    noNotice('missing');
  });
  it('opens frozen after an observed addition followed only by shrinking rows', async () => {
    history([run('a', 11), run('b', 10), run('c', 5), run('d', 0)]);
    files({ a: 'h\na\n', b: 'h\na\nb\n', c: 'h\nb\n', d: 'h\n' });
    await evaluateCsvFeedFreshness(now);
    expect(mocks.deliver).toHaveBeenCalledWith({ key: 'csv-feed:feed:frozen', title: 'CSV取込 在庫一覧', state: 'open',
      body: '「在庫一覧」のCSVが 10日間 同じ中身のままです。元のPower BIレポートの自動更新が止まっていないか確認してください。' }, now);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {
      lastComparedRunId: 'd', lastComparedRunAt: now, lastContentChangedAt: ago(10)
    } }));
  });
  it('waits longer than a weekly feed\'s own interval before calling it frozen', async () => {
    // Weekly arrivals => missing threshold 14 days, so 10 days without a change is still normal.
    mocks.state.mockResolvedValue(saved(10));
    mocks.query.mockResolvedValueOnce([run('c', 3), run('b', 10), run('a', 17)]).mockResolvedValueOnce([]);
    await evaluateCsvFeedFreshness(now);
    notice('frozen', 'recovered');
    mocks.deliver.mockClear();
    mocks.state.mockResolvedValue(saved(15));
    mocks.query.mockResolvedValueOnce([run('c', 3), run('b', 10), run('a', 17)]).mockResolvedValueOnce([]);
    await evaluateCsvFeedFreshness(now);
    notice('frozen', 'open');
  });
  it('recovers frozen on a new line and persists the new timestamp', async () => {
    mocks.state.mockResolvedValue(saved());
    mocks.query.mockResolvedValueOnce([run('before', 1)]).mockResolvedValueOnce([]);
    await evaluateCsvFeedFreshness(now);
    notice('frozen', 'open');
    mocks.deliver.mockClear();
    history([run('new', 0)], run('before', 1));
    files({ before: 'h\na\n', new: 'h\na\nb\n' });
    await evaluateCsvFeedFreshness(now);
    notice('frozen', 'recovered');
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {
      lastComparedRunId: 'new', lastComparedRunAt: now, lastContentChangedAt: now
    } }));
  });
  it.each(['', 'h\n', 'h\na\n'])('skips a static feed that never changed (%j)', async (content) => {
    history([run('a', 20), run('b', 10), run('c', 0)]);
    files({ a: content, b: content, c: content });
    await evaluateCsvFeedFreshness(now);
    noNotice('frozen');
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ lastContentChangedAt: null }) }));
  });
  it.each(['before', 'new'])('advances without changing the last change timestamp when %s is unreadable', async (missing) => {
    mocks.state.mockResolvedValue(saved());
    history([run('new', 0)], run('before', 1));
    files(missing === 'before' ? { new: 'h\na\nb\n' } : { before: 'h\na\n' });
    await evaluateCsvFeedFreshness(now);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {
      lastComparedRunId: 'new', lastComparedRunAt: now, lastContentChangedAt: ago(10)
    } }));
    expect(mocks.warn).toHaveBeenCalled();
  });
  it('does not compare across a missing file during initial history processing', async () => {
    history([run('a', 4), run('b', 3), run('c', 2), run('d', 0)]);
    files({ a: 'h\na\n', c: 'h\nb\n', d: 'h\nb\n' });
    await evaluateCsvFeedFreshness(now);
    noNotice('frozen');
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ lastContentChangedAt: null }) }));
    expect(mocks.query.mock.calls[1][0].values).toContainEqual(ago(60));
  });
  it('ignores header changes, ordering, duplicates, empty lines and trailing CR', async () => {
    mocks.state.mockResolvedValue(saved());
    history([run('new', 0)], run('before', 1));
    files({ before: 'old\r\na\r\nb\r\n', new: 'new\nb\na\na\n\n' });
    await evaluateCsvFeedFreshness(now);
    notice('frozen', 'open');
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ lastContentChangedAt: ago(10) }) }));
  });
  it('compares bytes losslessly, including non-UTF8 content', async () => {
    mocks.state.mockResolvedValue(saved());
    history([run('new', 0)], run('before', 1));
    files({ before: Buffer.from([104, 10, 128, 10]), new: Buffer.from([104, 10, 129, 10]) });
    await evaluateCsvFeedFreshness(now);
    notice('frozen', 'recovered');
    expect(mocks.read).toHaveBeenCalledWith('csv-dashboards/feed/raw/new.csv', { verifyIntegrity: true });
  });
  it('uses 5 days as the frozen threshold', () => {
    expect(CSV_FEED_FROZEN_DAYS).toBe(5);
  });
  it.each([4, CSV_FEED_FROZEN_DAYS - 1 / DAY, CSV_FEED_FROZEN_DAYS])('evaluates frozen boundary at %s days without new runs', async (days) => {
    mocks.state.mockResolvedValue(saved(days));
    mocks.query.mockResolvedValueOnce([run('before', 1)]);
    await evaluateCsvFeedFreshness(now);
    notice('frozen', days >= CSV_FEED_FROZEN_DAYS ? 'open' : 'recovered');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('recovers frozen when all runs are outside the 60-day window', async () => {
    mocks.state.mockResolvedValue(saved(70));
    mocks.query.mockResolvedValueOnce([run('old', 61)]);
    await evaluateCsvFeedFreshness(now);
    notice('frozen', 'recovered');
  });
  it('caps processing at 500 and resumes with a timestamp and id cursor before notifying', async () => {
    mocks.state.mockResolvedValue(saved());
    const runs = Array.from({ length: 501 }, (_, i) => run(String(i).padStart(3, '0'), 0));
    history(runs, run('before', 1));
    await evaluateCsvFeedFreshness(now);
    expect(mocks.read).toHaveBeenCalledTimes(501);
    const data = mocks.upsert.mock.calls[0][0].update;
    expect(data).toEqual({ lastComparedRunId: '499', lastComparedRunAt: now, lastContentChangedAt: ago(10) });
    noNotice('frozen');
    mocks.state.mockResolvedValue({ csvDashboardId: 'feed', ...data });
    history([runs[500]], runs[499]);
    await evaluateCsvFeedFreshness(now);
    expect(mocks.query.mock.calls[4][0].text).toContain('("runAt", "id") >');
    expect(mocks.query.mock.calls[4][0].values).toEqual(['feed', now, '499', 501]);
    notice('frozen', 'open');
  });
  it('ignores disabled schedules and non-dashboard targets, and deduplicates dashboard ids', async () => {
    mocks.config.mockResolvedValue({ config: { csvImports: [
      { enabled: false, targets: [{ type: 'csvDashboards', source: 'disabled' }] },
      { enabled: true },
      { targets: [{ type: 'csvDashboards', source: 'unset' }] },
      { enabled: true, targets: [{ type: 'items', source: 'items' }, { type: 'csvDashboards', source: 'feed' }, { type: 'csvDashboards', source: 'feed' }] }
    ] } });
    await evaluateCsvFeedFreshness(now);
    expect(mocks.dashboards).toHaveBeenCalledWith({ where: { id: { in: ['feed'] }, enabled: true },
      select: { id: true, name: true, gmailSubjectPattern: true } });
    expect(mocks.state).toHaveBeenCalledTimes(1);
  });
  it('does not evaluate disabled dashboards excluded by the database filter', async () => {
    mocks.dashboards.mockResolvedValue([]);
    await evaluateCsvFeedFreshness(now);
    expect(mocks.dashboards).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['feed'] }, enabled: true } }));
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it('does no work without enabled schedules', async () => {
    mocks.config.mockResolvedValue({ config: { csvImports: [{ enabled: false, targets: [{ type: 'csvDashboards', source: 'feed' }] }] } });
    await evaluateCsvFeedFreshness(now);
    expect(mocks.dashboards).not.toHaveBeenCalled();
  });
  it('logs one dashboard failure and continues evaluating others', async () => {
    mocks.dashboards.mockResolvedValue([{ ...dashboard, id: 'broken' }, dashboard]);
    const err = new Error('database unavailable');
    mocks.query.mockRejectedValueOnce(err).mockResolvedValueOnce([run('c', 4), run('b', 5), run('a', 6)]);
    await evaluateCsvFeedFreshness(now);
    expect(mocks.warn).toHaveBeenCalledWith({ err, csvDashboardId: 'broken' }, '[CsvFeedFreshness] Evaluation failed');
    notice('missing', 'open');
  });
  it('does not start the scheduler under NODE_ENV=test', async () => {
    const timer = vi.spyOn(global, 'setInterval');
    getCsvFeedFreshnessEvaluator().start();
    expect(timer).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
    await getCsvFeedFreshnessEvaluator().stop();
    timer.mockRestore();
  });
});
