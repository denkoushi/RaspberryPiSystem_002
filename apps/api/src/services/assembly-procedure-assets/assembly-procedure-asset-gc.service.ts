import { Prisma } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type {
  AssemblyProcedureAssetLocation,
  AssemblyProcedureAssetStoragePort,
} from './assembly-procedure-asset-storage.port.js';
import { getAssemblyProcedureAssetStorage } from './local-assembly-procedure-asset-storage.adapter.js';

/**
 * Keep newly uploaded/cropped blobs for one hour before collecting them. The
 * editor normally saves in a few seconds, while an abandoned browser tab can
 * still be recovered during that window. The owner lease is checked in SQL;
 * age is an additional guard against collecting an upload in flight.
 */
export const ASSEMBLY_PROCEDURE_ASSET_GC_MIN_AGE_MS = 60 * 60 * 1000;
export const ASSEMBLY_PROCEDURE_ASSET_GC_DEFAULT_LIMIT = 100;

export type AssemblyProcedureAssetGcCandidate = {
  id: string;
  storageKey: string;
};

export type AssemblyProcedureAssetGcOptions = {
  now?: Date;
  minAgeMs?: number;
  limit?: number;
  /** Narrow collection to assets superseded by one save operation. */
  candidateAssetIds?: readonly string[];
};

export type AssemblyProcedureAssetGcResult = {
  claimed: number;
  physicallyDeleted: number;
  physicalDeleteFailures: Array<{ id: string; storageKey: string }>;
};

/**
 * The service owns the policy (age, bounded batch, and physical cleanup),
 * while this port owns the DB locking/reference check. Keeping this seam small
 * makes the policy testable without connecting a unit test to Postgres.
 */
export interface AssemblyProcedureAssetGcRepository {
  claimAndDeleteUnreferencedAssets(input: {
    cutoff: Date;
    limit: number;
    candidateAssetIds?: readonly string[];
  }): Promise<AssemblyProcedureAssetGcCandidate[]>;
}

export class PrismaAssemblyProcedureAssetGcRepository
  implements AssemblyProcedureAssetGcRepository
{
  async claimAndDeleteUnreferencedAssets(input: {
    cutoff: Date;
    limit: number;
    candidateAssetIds?: readonly string[];
  }): Promise<AssemblyProcedureAssetGcCandidate[]> {
    const ids = input.candidateAssetIds?.filter(Boolean) ?? [];
    if (input.limit <= 0 || (input.candidateAssetIds && ids.length === 0)) return [];

    return prisma.$transaction(async (tx) => {
      const candidateFilter = ids.length > 0
        ? Prisma.sql`AND a."id" IN (${Prisma.join(ids)})`
        : Prisma.empty;
      // The asset row is locked before deleting it. INSERTing a new overlay or
      // source reference takes a key-share lock on the same parent row, so a
      // concurrent save waits for this transaction rather than racing a GC.
      const candidates = await tx.$queryRaw<AssemblyProcedureAssetGcCandidate[]>(Prisma.sql`
        SELECT a."id", a."storageKey"
        FROM "AssemblyProcedureAsset" a
        LEFT JOIN "AssemblyProcedureDocument" owner
          ON owner."id" = a."ownerDocumentId"
        WHERE a."createdAt" <= ${input.cutoff}
          AND NOT EXISTS (
            SELECT 1
            FROM "AssemblyProcedureOverlayElement" overlay
            WHERE overlay."assetId" = a."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "AssemblyProcedureDocumentRevision" revision
            WHERE revision."sourceAssetId" = a."id"
          )
          AND (
            a."ownerDocumentId" IS NULL
            OR owner."id" IS NULL
            OR owner."isActive" = false
            OR owner."status" <> 'DRAFT'
          )
          ${candidateFilter}
        ORDER BY a."createdAt" ASC, a."id" ASC
        LIMIT ${input.limit}
        FOR UPDATE OF a SKIP LOCKED
      `);

      const deleted: AssemblyProcedureAssetGcCandidate[] = [];
      for (const candidate of candidates) {
        // Re-check the row under the lock and return the exact storage key that
        // was removed. A failed DELETE is treated as a concurrent change and
        // is not sent to the physical storage adapter.
        const rows = await tx.$queryRaw<AssemblyProcedureAssetGcCandidate[]>(Prisma.sql`
          DELETE FROM "AssemblyProcedureAsset"
          WHERE "id" = ${candidate.id}
          RETURNING "id", "storageKey"
        `);
        if (rows[0]) deleted.push(rows[0]);
      }
      return deleted;
    });
  }
}

export type AssemblyProcedureAssetGcServiceOptions = {
  repository?: AssemblyProcedureAssetGcRepository;
  storage?: Pick<AssemblyProcedureAssetStoragePort, 'delete'>;
  logger?: Pick<typeof logger, 'warn'>;
};

export class AssemblyProcedureAssetGcService {
  private readonly repository: AssemblyProcedureAssetGcRepository;
  private readonly storage: Pick<AssemblyProcedureAssetStoragePort, 'delete'>;
  private readonly log: Pick<typeof logger, 'warn'>;

  constructor(options: AssemblyProcedureAssetGcServiceOptions = {}) {
    this.repository = options.repository ?? new PrismaAssemblyProcedureAssetGcRepository();
    this.storage = options.storage ?? getAssemblyProcedureAssetStorage();
    this.log = options.logger ?? logger;
  }

  async collect(options: AssemblyProcedureAssetGcOptions = {}): Promise<AssemblyProcedureAssetGcResult> {
    const now = options.now ?? new Date();
    const minAgeMs = options.minAgeMs ?? ASSEMBLY_PROCEDURE_ASSET_GC_MIN_AGE_MS;
    if (!Number.isFinite(minAgeMs) || minAgeMs < 0) {
      throw new Error('Assembly procedure asset GC minAgeMs must be a non-negative finite number');
    }
    const limit = Math.min(
      Math.max(Math.trunc(options.limit ?? ASSEMBLY_PROCEDURE_ASSET_GC_DEFAULT_LIMIT), 1),
      ASSEMBLY_PROCEDURE_ASSET_GC_DEFAULT_LIMIT,
    );
    const candidates = await this.repository.claimAndDeleteUnreferencedAssets({
      cutoff: new Date(now.getTime() - minAgeMs),
      limit,
      candidateAssetIds: options.candidateAssetIds,
    });

    const physicalDeleteFailures: AssemblyProcedureAssetGcResult['physicalDeleteFailures'] = [];
    let physicallyDeleted = 0;
    for (const candidate of candidates) {
      const reference: AssemblyProcedureAssetLocation = { storageKey: candidate.storageKey };
      try {
        await this.storage.delete(reference);
        physicallyDeleted += 1;
      } catch (error) {
        // DB metadata has already been deleted. Retaining the bytes is safe
        // for document correctness and leaves an auditable orphan for a
        // storage-level reconciliation job; do not fail the user's save.
        physicalDeleteFailures.push(candidate);
        this.log.warn(
          { err: error, assetId: candidate.id, storageKey: candidate.storageKey },
          'assembly_procedure_asset_gc_physical_delete_failed',
        );
      }
    }
    return {
      claimed: candidates.length,
      physicallyDeleted,
      physicalDeleteFailures,
    };
  }
}

let runtimeGcService: AssemblyProcedureAssetGcService | null = null;

export function getAssemblyProcedureAssetGcService(): AssemblyProcedureAssetGcService {
  if (!runtimeGcService) runtimeGcService = new AssemblyProcedureAssetGcService();
  return runtimeGcService;
}

export function resetAssemblyProcedureAssetGcServiceForTests(): void {
  runtimeGcService = null;
}
