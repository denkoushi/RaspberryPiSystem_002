import { randomUUID } from 'node:crypto';
import type { PrismaClient, ProductionScheduleDScheduleMinutesImportRun } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultBackupConfig } from '../../backup/backup-config.js';
import { FileStorageIntegrityMismatchError } from '../../file-storage/file-storage-errors.js';
import { buildWorkbook } from './__fixtures__/workbook.js';
import type { applyDScheduleMinutes } from './apply-d-schedule-minutes.service.js';
import { DScheduleMinutesGmailIngestionService } from './d-schedule-minutes-gmail-ingestion.service.js';
import { parseDScheduleMinutesXlsx } from './parse-d-schedule-minutes.js';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: { read } }) }));

const original: ProductionScheduleDScheduleMinutesImportRun = {
  id: 'original', gmailMessageId: 'gmail-id', kind: 'INTERNAL', filename: '20260515 D社日程会議議事録.xlsx',
  subject: '元の件名', meetingDate: new Date('2026-05-15Z'), receivedAt: new Date('2026-05-15T03:00Z'),
  createdAt: new Date('2026-05-15T04:00Z'), originalFilePath: 'csv-dashboards/d-schedule-minutes/original.xlsx',
  status: 'SUCCESS', warnings: [], autoRegisteredSeibans: {},
};

const runs = new Map<string, ProductionScheduleDScheduleMinutesImportRun>();
const saveOriginal = vi.fn();
const notify = vi.fn();
const gmailFactory = vi.fn();
const apply = vi.fn<typeof applyDScheduleMinutes>(async ({ result, metadata }) => {
  const run = {
    ...original, ...metadata, id: randomUUID(), kind: metadata.kind!, warnings: result.warnings,
    autoRegisteredSeibans: { autoRegistrationSkipped: 'STALE_FILE' },
  };
  runs.set(run.id, run);
  return run;
});
const service = new DScheduleMinutesGmailIngestionService({
  gmailFactory, saveOriginal, parse: parseDScheduleMinutesXlsx, apply, notify,
  db: {
    productionScheduleDScheduleMinutesImportRun: {
      findUnique: vi.fn(async ({ where }) => where.id ? runs.get(where.id) ?? null : null),
    },
  } as unknown as PrismaClient,
});
const runGmail = () => service.runOnce({ config: defaultBackupConfig, allowWait: false });

beforeEach(() => {
  vi.clearAllMocks();
  read.mockReset();
  runs.clear();
  runs.set(original.id, original);
});

describe('saved schedule minutes reimport', () => {
  it('creates a distinct run and notice key each time, preserving source metadata and redetecting the kind', async () => {
    const { workbook } = buildWorkbook();
    read.mockResolvedValue(Buffer.from(await workbook.xlsx.writeBuffer()));

    const first = await service.reimportOriginal(original.id);
    const second = await service.reimportOriginal(original.id);
    expect(runs.size).toBe(3);
    expect(runs.get(original.id)).toEqual(original);
    expect(first).toMatchObject({ status: 'SUCCESS', warningCounts: { UNKNOWN_STAR: 1 }, autoRegistrationSkipped: 'STALE_FILE' });
    expect(first.id).not.toBe(second.id);
    const imported = [runs.get(first.id)!, runs.get(second.id)!];
    expect(imported[0].gmailMessageId).not.toBe(imported[1].gmailMessageId);
    for (const run of imported) {
      expect(run).toMatchObject({
        gmailMessageId: expect.stringMatching(/^reimport:original:/), kind: 'D_COMPANY',
        filename: original.filename, subject: original.subject, receivedAt: original.receivedAt,
        originalFilePath: original.originalFilePath,
      });
      expect(notify).toHaveBeenCalledWith(run.gmailMessageId, run.warnings, 'D_COMPANY');
    }
    expect(read).toHaveBeenCalledWith(original.originalFilePath, { verifyIntegrity: true });
    expect(saveOriginal).not.toHaveBeenCalled();
    expect(gmailFactory).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing history or file reference', async () => {
    await expect(service.reimportOriginal('missing')).rejects.toMatchObject({ statusCode: 404, message: '取り込み履歴が見つかりません' });
    runs.set(original.id, { ...original, originalFilePath: null });
    await expect(service.reimportOriginal(original.id)).rejects.toMatchObject({ statusCode: 404, message: '元のファイルが保存されていません' });
    expect(read).not.toHaveBeenCalled();
  });

  it('reports a missing stored file, failed integrity check, or unreadable workbook without applying', async () => {
    read.mockRejectedValueOnce(Object.assign(new Error('File not found'), { code: 'ENOENT' }));
    read.mockRejectedValueOnce(new FileStorageIntegrityMismatchError());
    read.mockResolvedValueOnce(Buffer.from('invalid workbook'));
    await expect(service.reimportOriginal(original.id)).rejects.toMatchObject({ statusCode: 404, message: '保存先に元のファイルが見つかりません' });
    await expect(service.reimportOriginal(original.id)).rejects.toMatchObject({ statusCode: 503, code: 'FILE_STORAGE_INTEGRITY_MISMATCH' });
    await expect(service.reimportOriginal(original.id)).rejects.toMatchObject({ statusCode: 422 });
    expect(apply).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('returns 409 during Gmail ingestion', async () => {
    const factory = Promise.withResolvers<never>();
    gmailFactory.mockReturnValueOnce(factory.promise);
    const running = runGmail();
    try {
      expect(gmailFactory).toHaveBeenCalledOnce();
      await expect(service.reimportOriginal(original.id)).rejects.toMatchObject({ statusCode: 409 });
      expect(read).not.toHaveBeenCalled();
    } finally {
      factory.reject(new Error('Gmail unavailable'));
      await expect(running).rejects.toThrow('Gmail unavailable');
    }
  });

  it('prevents Gmail ingestion and another reimport from overlapping a running reimport', async () => {
    const storage = Promise.withResolvers<Buffer>();
    read.mockReturnValueOnce(storage.promise);
    const running = service.reimportOriginal(original.id);
    try {
      await expect(service.reimportOriginal(original.id)).rejects.toMatchObject({ statusCode: 409 });
      expect(await runGmail()).toMatchObject({ processed: 0 });
      expect(gmailFactory).not.toHaveBeenCalled();
    } finally {
      storage.resolve(Buffer.from('invalid workbook'));
      await expect(running).rejects.toMatchObject({ statusCode: 422 });
    }
  });
});
