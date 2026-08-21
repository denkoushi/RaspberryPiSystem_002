import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  getAssemblyProcedureAssetGcService,
  type AssemblyProcedureAssetGcService
} from '../assembly-procedure-assets/index.js';
import {
  collectAssemblyProcedureAssetIds,
  findConflictingAssemblyProcedureAssetLease,
  type AssemblyProcedureAssetLease
} from './assembly-procedure-document-asset-lifecycle.js';
import {
  assemblyProcedureAssetUrl,
  serializeAssemblyProcedureDocumentRevision,
  serializeAssemblyProcedureOverlayElement,
  type AssemblyProcedureDocumentRevisionDto
} from './assembly-procedure-document-revision.serializer.js';
import {
  elementToCreateData,
  normalizeElement,
  overlayToCreateDataFromRow,
  type AssemblyProcedureOverlayElementInput
} from './assembly-procedure-overlay.persistence.js';
import { AssemblyTemplateAccessService } from './assembly-template-access.service.js';
import { runAssemblyTransaction } from './assembly-transaction.js';

const revisionDocumentInclude = {
  pages: {
    orderBy: { pageIndex: 'asc' as const }
  },
  overlayElements: {
    orderBy: [
      { pageIndex: 'asc' as const },
      { zIndex: 'asc' as const },
      { createdAt: 'asc' as const }
    ],
    include: {
      asset: true
    }
  },
  revisionMetadata: true
} satisfies Prisma.AssemblyProcedureDocumentInclude;

export type AssemblyProcedureDocumentRevisionRecord = Prisma.AssemblyProcedureDocumentGetPayload<{
  include: typeof revisionDocumentInclude;
}>;

export {
  assemblyProcedureAssetUrl,
  serializeAssemblyProcedureDocumentRevision,
  serializeAssemblyProcedureOverlayElement
};
export type { AssemblyProcedureDocumentRevisionDto };
export {
  elementToCreateData,
  normalizeElement,
  overlayToCreateDataFromRow
};
export type { AssemblyProcedureOverlayElementInput };

type RevisionDocumentLockRow = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  isActive: boolean;
  revisionRootId: string | null;
  revisionNumber: number | null;
  supersedesDocumentId: string | null;
  isRevisionHead: boolean | null;
  editVersion: number | null;
  sourceAssetId: string | null;
};

export class AssemblyProcedureDocumentRevisionService {
  constructor(
    private readonly accessService = new AssemblyTemplateAccessService(),
    private readonly assetGc: AssemblyProcedureAssetGcService = getAssemblyProcedureAssetGcService()
  ) {}

  private async collectAssets(candidateAssetIds: readonly string[]): Promise<void> {
    if (candidateAssetIds.length === 0) return;
    try {
      // These candidates were detached by the just-committed save/discard.
      // The GC still rechecks references and active-DRAFT ownership in SQL,
      // so an exact post-transaction candidate set can be collected now.
      await this.assetGc.collect({ candidateAssetIds, minAgeMs: 0 });
    } catch (error) {
      // Asset cleanup is deliberately best-effort. Overlay persistence has
      // already committed and must not become unavailable because a storage
      // or maintenance connection is temporarily down.
      logger.warn(
        { err: error, candidateAssetIds },
        'assembly_procedure_asset_gc_after_overlay_save_failed'
      );
    }
  }

  async getById(id: string): Promise<AssemblyProcedureDocumentRevisionRecord | null> {
    return prisma.assemblyProcedureDocument.findUnique({
      where: { id },
      include: revisionDocumentInclude
    });
  }

  async listHistory(sourceId: string): Promise<AssemblyProcedureDocumentRevisionRecord[]> {
    const source = await prisma.assemblyProcedureDocument.findUnique({
      where: { id: sourceId },
      select: { id: true, revisionMetadata: true }
    });
    if (!source) throw new ApiError(404, '手順書が見つかりません');
    const rootId = source.revisionMetadata?.revisionRootId ?? source.id;
    return prisma.assemblyProcedureDocument.findMany({
      where: {
        OR: [
          { id: rootId },
          { revisionMetadata: { is: { revisionRootId: rootId } } }
        ]
      },
      include: revisionDocumentInclude,
      orderBy: [{ createdAt: 'asc' }]
    });
  }

  async createRevision(sourceId: string, accessPassword: string | undefined): Promise<AssemblyProcedureDocumentRevisionRecord> {
    await this.accessService.requireAccessPassword(accessPassword);
    return runAssemblyTransaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<RevisionDocumentLockRow>>`
        SELECT d."id", d."status", d."isActive", r."revisionRootId", r."revisionNumber",
               r."supersedesDocumentId", r."isRevisionHead", r."editVersion", r."sourceAssetId"
        FROM "AssemblyProcedureDocument" d
        LEFT JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
        WHERE d."id" = ${sourceId}
        FOR UPDATE OF d
      `;
      const source = locked[0];
      if (!source) throw new ApiError(404, '手順書が見つかりません');
      const hasMetadata = source.revisionRootId !== null;
      const isRevisionHead = source.isRevisionHead ?? true;
      const revisionNumber = source.revisionNumber ?? 1;
      if (!source.isActive || !isRevisionHead) {
        throw new ApiError(409, '最新版ではない手順書からは改版できません');
      }
      const sourceRecord = await tx.assemblyProcedureDocument.findUnique({
        where: { id: source.id },
        include: revisionDocumentInclude
      });
      if (!sourceRecord) throw new ApiError(404, '手順書が見つかりません');
      const rootId = source.revisionRootId ?? source.id;
      if (source.status === 'DRAFT') {
        // A draft is already the editable head. Legacy rows receive their
        // sidecar lazily so subsequent overlay edits have stable metadata.
        if (!hasMetadata) {
          await tx.assemblyProcedureDocumentRevision.create({
            data: {
              documentId: source.id,
              revisionRootId: rootId,
              revisionNumber: 1,
              isRevisionHead: true,
              editVersion: 0
            }
          });
        }
        const result = await tx.assemblyProcedureDocument.findUnique({
          where: { id: source.id },
          include: revisionDocumentInclude
        });
        if (!result) throw new ApiError(500, '改版手順書を取得できませんでした');
        return result;
      }
      if (!hasMetadata) {
        // Legacy published rows are represented as the superseded baseline.
        await tx.assemblyProcedureDocumentRevision.create({
          data: {
            documentId: source.id,
            revisionRootId: rootId,
            revisionNumber: 1,
            isRevisionHead: false,
            editVersion: 0
          }
        });
      }
      if (hasMetadata) {
        // The partial unique head index is checked per statement, so vacate
        // the old head before inserting the replacement revision.
        await tx.assemblyProcedureDocumentRevision.update({
          where: { documentId: source.id },
          data: { isRevisionHead: false }
        });
      }
      const max = await tx.assemblyProcedureDocumentRevision.aggregate({
        where: { revisionRootId: rootId },
        _max: { revisionNumber: true }
      });
      const nextRevisionNumber = Math.max(revisionNumber, max._max.revisionNumber ?? 1) + 1;
      const created = await tx.assemblyProcedureDocument.create({
        data: {
          name: sourceRecord.name,
          imageRelativePath: sourceRecord.imageRelativePath,
          status: 'DRAFT',
          publishedAt: null,
          isActive: true
        }
      });
      await tx.assemblyProcedureDocumentRevision.create({
        data: {
          documentId: created.id,
          revisionRootId: rootId,
          revisionNumber: nextRevisionNumber,
          supersedesDocumentId: source.id,
          isRevisionHead: true,
          editVersion: 0,
          sourceAssetId: source.sourceAssetId
        }
      });
      await tx.assemblyProcedureDocumentPage.createMany({
        data: sourceRecord.pages.map((page) => ({
          documentId: created.id,
          pageIndex: page.pageIndex,
          imageRelativePath: page.imageRelativePath
        }))
      });
      if (sourceRecord.overlayElements.length > 0) {
        await tx.assemblyProcedureOverlayElement.createMany({
          data: sourceRecord.overlayElements.map((overlay) => ({
            ...overlayToCreateDataFromRow(created.id, overlay),
            id: randomUUID()
          }))
        });
      }
      const result = await tx.assemblyProcedureDocument.findUnique({
        where: { id: created.id },
        include: revisionDocumentInclude
      });
      if (!result) throw new ApiError(500, '改版手順書を取得できませんでした');
      return result;
    });
  }

  async saveOverlays(params: {
    documentId: string;
    expectedEditVersion: number;
    elements: AssemblyProcedureOverlayElementInput[];
    accessPassword?: string;
  }): Promise<AssemblyProcedureDocumentRevisionRecord> {
    await this.accessService.requireAccessPassword(params.accessPassword);
    if (!Number.isInteger(params.expectedEditVersion) || params.expectedEditVersion < 0) {
      throw new ApiError(400, 'expectedEditVersionが不正です');
    }
    const normalized = params.elements.map((element, index) => normalizeElement(element, index));
    const ids = new Set<string>();
    for (const element of normalized) {
      if (ids.has(element.id)) throw new ApiError(400, 'overlay IDが重複しています');
      ids.add(element.id);
    }
    let replacedAssetIds: string[] = [];
    const result = await runAssemblyTransaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<RevisionDocumentLockRow>>`
        SELECT d."id", d."status", d."isActive", r."revisionRootId", r."revisionNumber",
               r."supersedesDocumentId", r."isRevisionHead", r."editVersion", r."sourceAssetId"
        FROM "AssemblyProcedureDocument" d
        LEFT JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
        WHERE d."id" = ${params.documentId}
        FOR UPDATE OF d
      `;
      const doc = locked[0];
      if (!doc) throw new ApiError(404, '手順書が見つかりません');
      if (!doc.revisionRootId || !doc.isRevisionHead || !doc.isActive || doc.status !== 'DRAFT') {
        throw new ApiError(409, '公開済みまたは旧版の手順書はoverlay編集できません');
      }
      if (doc.editVersion !== params.expectedEditVersion) {
        throw new ApiError(
          409,
          '手順書overlayが他の編集で更新されています。最新内容を再読込してください',
          { currentEditVersion: doc.editVersion },
          'ASSEMBLY_PROCEDURE_EDIT_CONFLICT'
        );
      }
      const pages = await tx.assemblyProcedureDocumentPage.findMany({
        where: { documentId: doc.id },
        select: { pageIndex: true }
      });
      const pageIndexes = new Set(pages.map((page) => page.pageIndex));
      for (const element of normalized) {
        if (!pageIndexes.has(element.pageIndex)) {
          throw new ApiError(400, `overlay ${element.id}のページが存在しません`);
        }
      }
      const imageAssetIds = normalized
        .filter((element): element is Extract<typeof element, { kind: 'IMAGE' }> => element.kind === 'IMAGE')
        .map((element) => element.assetId);
      if (imageAssetIds.length > 0) {
        const assets = await tx.assemblyProcedureAsset.findMany({
          where: { id: { in: [...new Set(imageAssetIds)] }, kind: 'OVERLAY_IMAGE' },
          select: {
            id: true,
            ownerDocumentId: true,
            ownerDocument: {
              select: { id: true, status: true, isActive: true }
            }
          }
        });
        if (assets.length !== new Set(imageAssetIds).size) {
          throw new ApiError(400, 'overlay画像assetが存在しません');
        }
        const conflictingLease = findConflictingAssemblyProcedureAssetLease(
          doc.id,
          assets as AssemblyProcedureAssetLease[]
        );
        if (conflictingLease) {
          throw new ApiError(
            409,
            '別のアクティブな改版下書きが保持しているoverlay画像は使用できません',
            { assetId: conflictingLease.id },
            'ASSEMBLY_PROCEDURE_ASSET_LEASE_CONFLICT'
          );
        }
      }
      const previousImageElements = await tx.assemblyProcedureOverlayElement.findMany({
        where: { documentId: doc.id, kind: 'IMAGE' },
        select: { assetId: true }
      });
      replacedAssetIds = [...new Set(
        previousImageElements
          .map((element) => element.assetId)
          .filter((assetId): assetId is string => assetId != null)
      )];
      await tx.assemblyProcedureOverlayElement.deleteMany({ where: { documentId: doc.id } });
      if (normalized.length > 0) {
        await tx.assemblyProcedureOverlayElement.createMany({
          data: normalized.map((element) => elementToCreateData(doc.id, element))
        });
      }
      if (imageAssetIds.length > 0) {
        await tx.assemblyProcedureAsset.updateMany({
          where: { id: { in: [...new Set(imageAssetIds)] }, kind: 'OVERLAY_IMAGE' },
          data: { ownerDocumentId: null }
        });
      }
      await tx.assemblyProcedureDocumentRevision.update({
        where: { documentId: doc.id },
        data: { editVersion: { increment: 1 } }
      });
      const result = await tx.assemblyProcedureDocument.findUnique({
        where: { id: doc.id },
        include: revisionDocumentInclude
      });
      if (!result) throw new ApiError(500, 'overlay保存後の手順書を取得できませんでした');
      return result;
    });
    await this.collectAssets(replacedAssetIds);
    return result;
  }

  async discardRevision(params: {
    documentId: string;
    accessPassword?: string;
    expectedEditVersion?: number;
  }): Promise<AssemblyProcedureDocumentRevisionRecord> {
    await this.accessService.requireAccessPassword(params.accessPassword);
    let discardedPagePaths: string[] = [];
    let discardedAssetIds: string[] = [];
    const result = await runAssemblyTransaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<RevisionDocumentLockRow>>`
        SELECT d."id", d."status", d."isActive", r."revisionRootId", r."revisionNumber",
               r."supersedesDocumentId", r."isRevisionHead", r."editVersion", r."sourceAssetId"
        FROM "AssemblyProcedureDocument" d
        LEFT JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
        WHERE d."id" = ${params.documentId}
        FOR UPDATE OF d
      `;
      const doc = locked[0];
      if (!doc) throw new ApiError(404, '手順書が見つかりません');
      if (!doc.revisionRootId || !doc.isRevisionHead || doc.status !== 'DRAFT') {
        throw new ApiError(409, '最新版の改版下書きだけ破棄できます');
      }
      if (!doc.supersedesDocumentId) {
        throw new ApiError(409, 'ルート文書は破棄できません');
      }
      const previousDocumentId = doc.supersedesDocumentId;
      if (params.expectedEditVersion != null && params.expectedEditVersion !== doc.editVersion) {
        throw new ApiError(409, '手順書overlayが他の編集で更新されています', { currentEditVersion: doc.editVersion }, 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT');
      }
      const discarded = await tx.assemblyProcedureDocument.findUnique({
        where: { id: doc.id },
        select: {
          pages: { select: { imageRelativePath: true } },
          overlayElements: { where: { kind: 'IMAGE' }, select: { assetId: true } },
          ownedAssets: { select: { id: true } }
        }
      });
      discardedPagePaths = [...new Set(discarded?.pages.map((page) => page.imageRelativePath) ?? [])];
      discardedAssetIds = collectAssemblyProcedureAssetIds({
        sourceAssetId: doc.sourceAssetId,
        overlayAssetIds: discarded?.overlayElements.map((element) => element.assetId),
        ownedAssetIds: discarded?.ownedAssets.map((asset) => asset.id)
      });
      await tx.assemblyProcedureDocumentRevision.update({
        where: { documentId: doc.id },
        data: { isRevisionHead: false }
      });
      await tx.assemblyProcedureDocumentRevision.update({
        where: { documentId: previousDocumentId },
        data: { isRevisionHead: true }
      });
      try {
        // A discarded DRAFT is not a published history node. Removing it
        // clears its overlay/page references and makes abandoned assets
        // eligible for the bounded GC without touching the previous version.
        await tx.assemblyProcedureDocument.delete({ where: { id: doc.id } });
      } catch (error) {
        logger.warn({ err: error, documentId: doc.id }, 'assembly_procedure_revision_discard_delete_failed');
        throw new ApiError(
          409,
          '参照中の改版下書きは破棄できません',
          undefined,
          'ASSEMBLY_PROCEDURE_REVISION_IN_USE'
        );
      }
      const previous = await tx.assemblyProcedureDocument.findUnique({
        where: { id: previousDocumentId },
        include: revisionDocumentInclude
      });
      if (!previous) throw new ApiError(500, '改版破棄後の直前版を取得できませんでした');
      return previous;
    });
    await this.collectAssets(discardedAssetIds);
    for (const imageRelativePath of discardedPagePaths) {
      try {
        const [documentCount, pageCount] = await Promise.all([
          prisma.assemblyProcedureDocument.count({ where: { imageRelativePath } }),
          prisma.assemblyProcedureDocumentPage.count({ where: { imageRelativePath } })
        ]);
        if (documentCount === 0 && pageCount === 0) {
          await AssemblyProcedureImageStorage.deleteImage(imageRelativePath);
        }
      } catch (error) {
        logger.warn({ err: error, imageRelativePath }, 'assembly_procedure_revision_discard_image_cleanup_failed');
      }
    }
    return result;
  }
}
