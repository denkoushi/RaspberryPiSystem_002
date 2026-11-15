import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// Use Prisma's real SQL helpers without loading a generated DB client.
vi.mock('@prisma/client', async () => {
  const { sqltag, join, raw, empty } = await import('@prisma/client/runtime/client');
  return { Prisma: { sql: sqltag, join, raw, empty } };
});

const cron = vi.hoisted(() => ({ schedule: vi.fn(), stop: vi.fn() }));
vi.mock('node-cron', () => ({ default: cron }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { retainLoanPhotos } from '../loan-photo-retention.js';
import { LoanPhotoRetentionScheduler } from '../loan-photo-retention.scheduler.js';

type Deps = Parameters<typeof retainLoanPhotos>[0];
const now = new Date('2026-11-15T18:50:00.000Z');
const cutoff = new Date('2025-11-15T18:50:00.000Z');
function loan(id: string, overrides = {}) {
  return {
    id, photoUrl: `/api/storage/photos/2025/11/${id}.jpg`, photoTakenAt: new Date(cutoff.getTime() - 1),
    returnedAt: new Date('2025-11-16T00:00:00Z') as Date | null,
    cancelledAt: null as Date | null, photoToolGallerySeed: false, ...overrides,
  };
}

function fixture(rows = [loan('a')], mode: Deps['config']['mode'] = 'report', batchLimit = 500) {
  const gallery = new Set<string>();
  const itemUrls = new Set<string>();
  const importUrls = new Set<string>();
  const events: string[] = [];
  const sorted = [...rows].sort((a, b) => Number(a.photoTakenAt) - Number(b.photoTakenAt) || a.id.localeCompare(b.id));
  const db = {
    loan: {
      findMany: vi.fn(async (args) => {
        // Apply the requested Prisma filters, so boundary tests exercise the actual query contract.
        const eligible = sorted.filter(r => r.photoUrl !== null && r.photoTakenAt !== null && r.photoTakenAt < args.where.photoTakenAt.lt);
        const start = args.cursor ? eligible.findIndex(r => r.id === args.cursor.id) + args.skip : 0;
        return eligible.slice(start, start + args.take);
      }),
      findFirst: vi.fn(async ({ where }) => rows.find(r => r.id === where.id && r.photoUrl === where.photoUrl && r.returnedAt !== null && !r.photoToolGallerySeed) ?? null),
      update: vi.fn(async ({ where, data }) => {
        events.push(`update:${where.id}`);
        Object.assign(rows.find(r => r.id === where.id)!, data);
        return {};
      }),
    },
    $queryRaw: vi.fn(async (query: Prisma.Sql) => {
      expect(query.sql).toContain('FROM "photo_tool_similarity_gallery"');
      return [...gallery].filter(id => query.values.includes(id)).map(loanId => ({ loanId }));
    }),
    inventoryItemPhoto: { findMany: vi.fn(async ({ where }) => [...itemUrls].filter(url => where.photoUrl.in.includes(url)).map(photoUrl => ({ photoUrl }))) },
    inventoryImportPhoto: { findMany: vi.fn(async ({ where }) => [...importUrls].filter(url => where.photoUrl.in.includes(url)).map(photoUrl => ({ photoUrl }))) },
  };
  const store = {
    delete: vi.fn(async (key: string) => { events.push(`delete:${key}`); }),
    write: vi.fn(async () => ({ key: '', sha256: '', size: 0 })),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const deps: Deps = { prisma: db as unknown as Deps['prisma'], store, logger, now, config: { mode, days: 365, batchLimit } };
  return { db, store, logger, deps, events, gallery, itemUrls, importUrls };
}

describe('loan photo retention', () => {
  it('selects only returned photos strictly older than one year, using photoTakenAt', async () => {
    const f = fixture([
      loan('old'), loan('exact', { photoTakenAt: cutoff }),
      loan('after', { photoTakenAt: new Date(cutoff.getTime() + 1) }),
      loan('recent', { photoTakenAt: now }), loan('missing-date', { photoTakenAt: null }),
      loan('missing-photo', { photoUrl: null }),
      loan('old-folder-new-photo', { photoUrl: '/api/storage/photos/2000/01/new.jpg', photoTakenAt: now }),
    ]);
    const result = await retainLoanPhotos(f.deps);
    expect(result.targets.map(t => t.loanId)).toEqual(['old']);
    expect(result.cutoff).toEqual(cutoff);
    expect(f.db.loan.findMany.mock.calls[0][0]).toMatchObject({ where: { photoUrl: { not: null }, photoTakenAt: { lt: cutoff } } });
  });

  it('uses a calendar year across leap years', async () => {
    const f = fixture();
    f.deps.now = new Date('2024-03-01T03:00:00Z');
    expect((await retainLoanPhotos(f.deps)).cutoff).toEqual(new Date('2023-03-01T03:00:00Z'));
    f.deps.now = new Date('2024-02-29T03:00:00Z');
    expect((await retainLoanPhotos(f.deps)).cutoff).toEqual(new Date('2023-02-28T03:00:00Z'));
  });

  it('supports a custom retention duration in days', async () => {
    const f = fixture(); f.deps.config.days = 30;
    expect((await retainLoanPhotos(f.deps)).cutoff.getTime()).toBe(now.getTime() - 30 * 86400000);
  });

  it('keeps unreturned and cancelled-unreturned photos and counts both', async () => {
    const f = fixture([loan('open', { returnedAt: null }), loan('cancelled', { returnedAt: null, cancelledAt: now })], 'delete');
    const result = await retainLoanPhotos(f.deps);
    expect(result.excluded).toMatchObject({ unreturned: 2, cancelledUnreturned: 1 });
    expect(result.targetCount).toBe(0);
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it('keeps gallery seeds', async () => {
    const f = fixture([loan('seed', { photoToolGallerySeed: true })], 'delete');
    expect((await retainLoanPhotos(f.deps)).excluded.gallerySeed).toBe(1);
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it('keeps similarity gallery rows regardless of embedding model', async () => {
    const f = fixture(undefined, 'delete'); f.gallery.add('a');
    expect((await retainLoanPhotos(f.deps)).excluded.similarityGallery).toBe(1);
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it.each(['itemUrls', 'importUrls'] as const)('keeps URLs referenced by %s', async (kind) => {
    const row = loan('a'); const f = fixture([row], 'delete'); f[kind].add(row.photoUrl);
    expect((await retainLoanPhotos(f.deps)).excluded.inventoryReference).toBe(1);
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it('reports all targets without changing photos or DB, and logs only counts', async () => {
    const f = fixture(); const result = await retainLoanPhotos(f.deps);
    expect(result.targetCount).toBe(1);
    expect(f.store.delete).not.toHaveBeenCalled(); expect(f.db.loan.update).not.toHaveBeenCalled();
    expect(f.store.write).toHaveBeenCalledWith(expect.objectContaining({ key: 'reports/loan-photo-retention/latest.json', mode: 'replace', integrity: true }));
    const report = JSON.parse((f.store.write.mock.calls[0] as unknown as [{ data: Buffer }])[0].data.toString());
    expect(report.targets).toEqual([{ loanId: 'a', photoUrl: loan('a').photoUrl, photoTakenAt: loan('a').photoTakenAt.toISOString() }]);
    expect(f.logger.info.mock.calls[0][0]).not.toHaveProperty('targets');
  });

  it('deletes both files before clearing only photoUrl', async () => {
    const f = fixture(undefined, 'delete'); const result = await retainLoanPhotos(f.deps);
    expect(result.deleted).toBe(1);
    expect(f.events).toEqual(['delete:photos/2025/11/a.jpg', 'delete:thumbnails/2025/11/a_thumb.jpg', 'update:a']);
    expect(f.store.delete.mock.calls).toEqual([
      ['photos/2025/11/a.jpg', { integrity: true }], ['thumbnails/2025/11/a_thumb.jpg', { integrity: true }],
    ]);
    expect(f.db.loan.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { photoUrl: null } });
    expect(f.store.write).toHaveBeenCalledTimes(2);
  });

  it.each([1, 2])('continues after failure deleting file %i without clearing its loan URL', async (file) => {
    const rows = [loan('a'), loan('b')]; const f = fixture(rows, 'delete');
    if (file === 2) f.store.delete.mockResolvedValueOnce(undefined);
    f.store.delete.mockRejectedValueOnce(new Error('storage failure'));
    const result = await retainLoanPhotos(f.deps);
    expect(result).toMatchObject({ failed: 1, deleted: 1 });
    expect(rows[0].photoUrl).toBe(loan('a').photoUrl); expect(rows[1].photoUrl).toBeNull();
    expect(f.db.loan.update).toHaveBeenCalledTimes(1);
  });

  it('continues after a DB update failure', async () => {
    const f = fixture([loan('a'), loan('b')], 'delete');
    f.db.loan.update.mockRejectedValueOnce(new Error('DB unavailable'));
    expect(await retainLoanPhotos(f.deps)).toMatchObject({ failed: 1, deleted: 1 });
  });

  it('limits deletion to the oldest targets, then naturally picks up leftovers', async () => {
    const rows = [loan('newer'), loan('older', { photoTakenAt: new Date('2020-01-01') })];
    const f = fixture(rows, 'delete', 1);
    expect(await retainLoanPhotos(f.deps)).toMatchObject({ targetCount: 2, deleted: 1, deferred: 1 });
    expect(f.db.loan.update.mock.calls[0][0].where.id).toBe('older');
    expect(await retainLoanPhotos(f.deps)).toMatchObject({ targetCount: 1, deleted: 1, deferred: 0 });
  });

  it('pages past protected rows to find older backlog and complete counts', async () => {
    const f = fixture(Array.from({ length: 501 }, (_, i) => loan(String(i).padStart(4, '0'), { photoToolGallerySeed: i < 500 })));
    const result = await retainLoanPhotos(f.deps);
    expect(result.targetCount).toBe(1); expect(result.excluded.gallerySeed).toBe(500);
    expect(f.db.loan.findMany).toHaveBeenCalledTimes(2);
  });

  it('rechecks references before deletion', async () => {
    const f = fixture(undefined, 'delete');
    f.store.write.mockImplementationOnce(async () => { f.gallery.add('a'); return { key: '', sha256: '', size: 0 }; });
    expect(await retainLoanPhotos(f.deps)).toMatchObject({ skipped: 1, deleted: 0 });
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it('does not delete when writing the initial report fails', async () => {
    const f = fixture(undefined, 'delete'); f.store.write.mockRejectedValueOnce(new Error('full'));
    await expect(retainLoanPhotos(f.deps)).rejects.toThrow('full');
    expect(f.store.delete).not.toHaveBeenCalled(); expect(f.db.loan.update).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    const f = fixture(undefined, 'disabled');
    expect(await retainLoanPhotos(f.deps)).toMatchObject({ targetCount: 0, deleted: 0 });
    expect(f.db.loan.findMany).not.toHaveBeenCalled(); expect(f.store.write).not.toHaveBeenCalled();
  });
});

describe('LoanPhotoRetentionScheduler', () => {
  beforeEach(() => { vi.clearAllMocks(); cron.schedule.mockReturnValue({ stop: cron.stop }); });

  it('schedules once daily at 03:50 Asia/Tokyo and stops', async () => {
    const scheduler = new LoanPhotoRetentionScheduler(vi.fn());
    scheduler.start(); scheduler.start();
    expect(cron.schedule).toHaveBeenCalledExactlyOnceWith('50 3 * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    await scheduler.stop(); expect(cron.stop).toHaveBeenCalledTimes(1);
  });

  it('prevents overlapping ticks and waits for active work on stop', async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const scheduler = new LoanPhotoRetentionScheduler(run as unknown as ConstructorParameters<typeof LoanPhotoRetentionScheduler>[0]);
    const active = scheduler.runTick(); await scheduler.runTick();
    expect(run).toHaveBeenCalledTimes(1);
    let stopped = false; const stop = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    finish(); await Promise.all([active, stop]); expect(stopped).toBe(true);
  });

  it('contains failures and allows the next tick', async () => {
    const run = vi.fn().mockRejectedValue(new Error('failure'));
    const scheduler = new LoanPhotoRetentionScheduler(run);
    await scheduler.runTick(); await scheduler.runTick(); expect(run).toHaveBeenCalledTimes(2);
  });
});
