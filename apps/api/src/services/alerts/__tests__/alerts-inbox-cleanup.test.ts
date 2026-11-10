import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { alert: { findMany: mocks.findMany } } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: mocks.info, warn: mocks.warn } }));
import { cleanupAlertsInbox } from '../alerts-inbox-cleanup.js';

const DAY = 86400_000;

describe('alerts inbox cleanup', () => {
  let dir: string;
  const now = Date.now();

  async function file(name: string, content: string, days = 31) {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, content);
    await fs.utimes(filePath, new Date(now - days * DAY), new Date(now - days * DAY));
    return filePath;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('ALERTS_INBOX_RETENTION_DAYS', '30');
    mocks.findMany.mockResolvedValue([{ id: 'ingested' }]);
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alerts-cleanup-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('deletes only old empty files and old ingested strict JSON files', async () => {
    await file('alert-empty.json', '', 2);
    await file('alert-empty.json.1', '', 2);
    await file('alert-young-empty.json', '', 0.5);
    await file('alert-boundary-empty.json', '', 1);
    await file('alert-ingested.json', '{"id":"ingested"}');
    await file('alert-rotated.json.1', '{"id":"ingested"}');
    await file('alert-young.json', '{"id":"ingested"}', 29);
    await file('alert-boundary.json', '{"id":"ingested"}', 30);
    await file('alert-undelivered.json', '{"id":"missing"}');
    await file('alert-invalid.json', '{"id":"ingested",}');
    await file('alert-no-id.json', '{}');
    await file('.pi5-scheduler-leader', '');
    await file('other.json', '');
    await file('alert-backup.json.2', '');
    await file('alert-compressed.json.1.gz', '');
    const nested = path.join(dir, 'alert-directory.json');
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, 'alert-nested.json'), '');
    await fs.symlink(path.join(dir, 'alert-undelivered.json'), path.join(dir, 'alert-link.json'));

    await cleanupAlertsInbox(dir, now);

    expect((await fs.readdir(dir)).sort()).toEqual([
      '.pi5-scheduler-leader', 'alert-backup.json.2', 'alert-boundary-empty.json',
      'alert-boundary.json', 'alert-compressed.json.1.gz', 'alert-directory.json',
      'alert-invalid.json', 'alert-link.json', 'alert-no-id.json', 'alert-undelivered.json',
      'alert-young-empty.json', 'alert-young.json', 'other.json'
    ].sort());
    expect(await fs.readFile(path.join(nested, 'alert-nested.json'), 'utf8')).toBe('');
    expect(mocks.info).toHaveBeenCalledWith({ deletedEmpty: 2, deletedIngested: 2,
      keptUnparseable: 1, keptNotInDb: 2, errors: 0 }, '[AlertsIngestor] Inbox cleanup completed');
  });

  it('uses configured retention and falls back to 30 days for invalid values', async () => {
    await file('alert-config.json.1', '{"id":"ingested"}', 10);
    for (const value of ['invalid', '0', '-1', 'Infinity']) {
      vi.stubEnv('ALERTS_INBOX_RETENTION_DAYS', value);
      await cleanupAlertsInbox(dir, now);
      expect(await fs.readdir(dir)).toEqual(['alert-config.json.1']);
    }
    vi.stubEnv('ALERTS_INBOX_RETENTION_DAYS', '7');
    await cleanupAlertsInbox(dir, now);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('bounds DB lookups to 100 ids and keeps a batch on DB failure', async () => {
    for (let index = 0; index < 205; index++) {
      await file(`alert-${index}.json.1`, '{"id":"ingested"}');
    }
    mocks.findMany.mockRejectedValueOnce(new Error('DB unavailable'));
    await cleanupAlertsInbox(dir, now);
    expect(mocks.findMany.mock.calls.map(([query]) => query.where.id.in.length)).toEqual([100, 100, 5]);
    expect(await fs.readdir(dir)).toHaveLength(100);
  });

  it('continues after a single-file deletion error', async () => {
    await file('alert-first.json', '', 2);
    await file('alert-second.json', '', 2);
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockRejectedValueOnce(new Error('permission denied')).mockImplementation(unlink);
    await cleanupAlertsInbox(dir, now);
    expect(await fs.readdir(dir)).toHaveLength(1);
    expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ deletedEmpty: 1, errors: 1 }),
      '[AlertsIngestor] Inbox cleanup completed');
  });

  it('keeps a file changed while its DB lookup is pending', async () => {
    const filePath = await file('alert-changing.json', '{"id":"ingested"}');
    mocks.findMany.mockImplementationOnce(async () => {
      await fs.writeFile(filePath, '{"id":"new-alert"}');
      return [{ id: 'ingested' }];
    });
    await cleanupAlertsInbox(dir, now);
    expect(await fs.readFile(filePath, 'utf8')).toBe('{"id":"new-alert"}');
  });
});
