import { Prisma, type PrismaClient } from '@prisma/client';

import { PhotoStorage } from '../../lib/photo-storage.js';
import type { logger as appLogger } from '../../lib/logger.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';

export type LoanPhotoRetentionConfig = {
  mode: 'disabled' | 'report' | 'delete';
  days: number;
  batchLimit: number;
};

type Dependencies = {
  prisma: Pick<PrismaClient, 'loan' | 'inventoryItemPhoto' | 'inventoryImportPhoto' | '$queryRaw'>;
  store: Pick<DurableFileStorePort, 'delete' | 'write'>;
  logger: Pick<typeof appLogger, 'info' | 'warn'>;
  now: Date;
  config: LoanPhotoRetentionConfig;
};

export type LoanPhotoRetentionTarget = { loanId: string; photoUrl: string; photoTakenAt: Date };

// The default means one calendar year, including leap years. Custom values mean elapsed days.
function retentionCutoff(now: Date, days: number): Date {
  if (days !== 365) return new Date(now.getTime() - days * 86400000);
  const cutoff = new Date(now);
  const month = cutoff.getUTCMonth();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  if (cutoff.getUTCMonth() !== month) cutoff.setUTCDate(0);
  return cutoff;
}

export async function retainLoanPhotos({ prisma, store, logger, now, config }: Dependencies) {
  const cutoff = retentionCutoff(now, config.days);
  const excluded = { unreturned: 0, cancelledUnreturned: 0, gallerySeed: 0, similarityGallery: 0, inventoryReference: 0 };
  const targets: LoanPhotoRetentionTarget[] = [];
  const result = {
    mode: config.mode, generatedAt: now, cutoff, batchLimit: config.batchLimit,
    targetCount: 0, targets, excluded, deleted: 0, failed: 0, deferred: 0, skipped: 0,
  };
  if (config.mode === 'disabled') return result;

  const expiredWhere = { photoUrl: { not: null }, photoTakenAt: { lt: cutoff } };
  const select = {
    id: true, photoUrl: true, photoTakenAt: true, returnedAt: true, cancelledAt: true, photoToolGallerySeed: true,
  } as const;
  type Row = Prisma.LoanGetPayload<{ select: typeof select }>;

  async function references(rows: Row[]) {
    const urls = rows.flatMap(row => row.photoUrl ? [row.photoUrl] : []);
    const [gallery, itemPhotos, importPhotos] = await Promise.all([
      prisma.$queryRaw<{ loanId: string }[]>(Prisma.sql`
        SELECT "loanId" FROM "photo_tool_similarity_gallery"
        WHERE "loanId" IN (${Prisma.join(rows.map(row => row.id))})
      `),
      prisma.inventoryItemPhoto.findMany({ where: { photoUrl: { in: urls } }, select: { photoUrl: true } }),
      prisma.inventoryImportPhoto.findMany({ where: { photoUrl: { in: urls } }, select: { photoUrl: true } }),
    ]);
    return {
      gallery: new Set(gallery.map(row => row.loanId)),
      inventory: new Set([...itemPhotos, ...importPhotos].map(row => row.photoUrl)),
    };
  }

  // Page reads independently of the deletion limit so reports include all eligible rows and exclusions.
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.loan.findMany({
      where: expiredWhere, select, orderBy: [{ photoTakenAt: 'asc' }, { id: 'asc' }], take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    const refs = await references(rows);
    for (const row of rows) {
      const unreturned = row.returnedAt === null;
      const gallery = refs.gallery.has(row.id);
      const inventory = row.photoUrl !== null && refs.inventory.has(row.photoUrl);
      // Counts overlap; cancelledUnreturned is a subset of unreturned.
      if (unreturned) excluded.unreturned++;
      if (unreturned && row.cancelledAt) excluded.cancelledUnreturned++;
      if (row.photoToolGallerySeed) excluded.gallerySeed++;
      if (gallery) excluded.similarityGallery++;
      if (inventory) excluded.inventoryReference++;
      if (!unreturned && !row.photoToolGallerySeed && !gallery && !inventory && row.photoUrl && row.photoTakenAt) {
        targets.push({ loanId: row.id, photoUrl: row.photoUrl, photoTakenAt: row.photoTakenAt });
      }
    }
    if (rows.length < 500) break;
    cursor = rows[rows.length - 1].id;
  }
  result.targetCount = targets.length;
  result.deferred = Math.max(0, targets.length - config.batchLimit);

  // Persist the plan before any destructive work; a report write failure leaves photos untouched.
  const writeReport = () => store.write({
    key: 'reports/loan-photo-retention/latest.json', data: Buffer.from(JSON.stringify(result, null, 2)),
    mode: 'replace', integrity: true,
  });
  await writeReport();
  if (config.mode === 'delete') {
    for (const target of targets.slice(0, config.batchLimit)) {
      try {
        // Recheck protection after the scan, since gallery/inventory references may have changed.
        const row = await prisma.loan.findFirst({
          where: { ...expiredWhere, id: target.loanId, photoUrl: target.photoUrl, returnedAt: { not: null }, photoToolGallerySeed: false },
          select,
        });
        if (!row) { result.skipped++; continue; }
        const refs = await references([row]);
        if (refs.gallery.has(row.id) || refs.inventory.has(target.photoUrl)) { result.skipped++; continue; }
        await PhotoStorage.deletePhoto(target.photoUrl, store);
        await prisma.loan.update({ where: { id: target.loanId }, data: { photoUrl: null } });
        result.deleted++;
      } catch (error) {
        result.failed++;
        logger.warn({ loanId: target.loanId, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Loan photo retention failed');
      }
    }
    await writeReport();
  }
  const counts = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'targets'));
  logger.info(counts, 'Loan photo retention completed');
  return result;
}

export async function runLoanPhotoRetention() {
  const [{ prisma }, { env }, { getFileStorageRuntime }, { logger }] = await Promise.all([
    import('../../lib/prisma.js'), import('../../config/env.js'),
    import('../file-storage/file-storage-runtime.js'), import('../../lib/logger.js'),
  ]);
  return retainLoanPhotos({
    prisma, store: getFileStorageRuntime().store, logger, now: new Date(),
    config: { mode: env.LOAN_PHOTO_RETENTION_MODE, days: env.LOAN_PHOTO_RETENTION_DAYS, batchLimit: env.LOAN_PHOTO_RETENTION_BATCH_LIMIT },
  });
}
