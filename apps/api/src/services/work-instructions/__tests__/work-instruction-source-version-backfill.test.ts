import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { WorkInstructionDbClient } from '../repositories/prisma-work-instruction.persistence.types.js';
import { backfillWorkInstructionSourceVersions } from '../work-instruction-source-version-backfill.service.js';

function fakeDatabase() {
  const sourceRows = ['row-a', 'row-b'].map((id, index) => ({
    id,
    sourceModified: new Date(`2026-08-${29 + index}T00:00:00.000Z`),
    partNumber: 'MD004',
    shootingTarget: '研削',
    rawManifest: { fixture: id },
    contentHash: id.padEnd(64, '0'),
    steps: [{
      step: 1n,
      text: `${id}-step`,
      imageName: null,
      assetId: null,
      asset: null
    }]
  }));
  const publications = new Map<string, { rowId: string; latestVersionId: string; publishedVersionId: string }>();
  const versions = new Map<string, { id: string }>();
  const transaction = {
    workInstructionRow: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => sourceRows.find((row) => row.id === where.id) ?? null)
    },
    workInstructionSourcePublication: {
      findUnique: vi.fn(async ({ where }: { where: { rowId: string } }) => publications.get(where.rowId) ?? null),
      upsert: vi.fn(async ({ create }: { create: { rowId: string; latestVersionId: string; publishedVersionId: string } }) => {
        const existing = publications.get(create.rowId);
        if (existing) return existing;
        const publication = { ...create };
        publications.set(create.rowId, publication);
        return publication;
      }),
      create: vi.fn(async ({ data }: { data: { rowId: string; latestVersionId: string; publishedVersionId: string } }) => {
        const publication = { ...data };
        publications.set(data.rowId, publication);
        return publication;
      })
    },
    workInstructionSourceVersion: {
      findUnique: vi.fn(async ({ where }: { where: { rowId_sourceModified_contentHash: { rowId: string; sourceModified: Date; contentHash: string } } }) => {
        const key = where.rowId_sourceModified_contentHash;
        return versions.get(`${key.rowId}:${key.sourceModified.toISOString()}:${key.contentHash}`) ?? null;
      }),
      upsert: vi.fn(async ({ where, create }: { where: { rowId_sourceModified_contentHash: { rowId: string; sourceModified: Date; contentHash: string } }; create: { rowId: string; sourceModified: Date; contentHash: string } }) => {
        const key = where.rowId_sourceModified_contentHash;
        const storageKey = `${key.rowId}:${key.sourceModified.toISOString()}:${key.contentHash}`;
        const existing = versions.get(storageKey);
        if (existing) return existing;
        const version = { id: `version-${create.rowId}` };
        versions.set(storageKey, version);
        return version;
      }),
      create: vi.fn(async ({ data }: { data: { rowId: string; sourceModified: Date; contentHash: string } }) => {
        const version = { id: `version-${data.rowId}` };
        versions.set(`${data.rowId}:${data.sourceModified.toISOString()}:${data.contentHash}`, version);
        return version;
      })
    }
  };
  const db = {
    workInstructionRow: {
      findMany: vi.fn(async ({ where, take }: { where?: { id: { gt: string } }; take: number }) => {
        const after = where?.id.gt;
        return sourceRows.filter((row) => !after || row.id > after).slice(0, take).map(({ id }) => ({ id }));
      })
    },
    $transaction: async (callback: (tx: WorkInstructionDbClient) => Promise<boolean>) => callback(transaction as unknown as WorkInstructionDbClient)
  } as unknown as PrismaClient;
  return { db, publications, transaction };
}

describe('work-instruction source-version backfill', () => {
  it('is idempotent when the command is run more than once', async () => {
    const fixture = fakeDatabase();
    const first = await backfillWorkInstructionSourceVersions(fixture.db, { batchSize: 1, now: () => new Date('2026-08-31T00:00:00.000Z') });
    const second = await backfillWorkInstructionSourceVersions(fixture.db, { batchSize: 1, now: () => new Date('2026-08-31T00:00:00.000Z') });

    expect(first).toEqual({ scanned: 2, created: 2, alreadyPresent: 0, raced: 0 });
    expect(second).toEqual({ scanned: 2, created: 0, alreadyPresent: 2, raced: 0 });
    expect(fixture.publications.size).toBe(2);
    expect(fixture.transaction.workInstructionSourcePublication.upsert).toHaveBeenCalledTimes(2);
  });
});
