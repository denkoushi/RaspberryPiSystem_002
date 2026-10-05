import { AssemblyProcedureDocumentEditLeaseService, type AssemblyProcedureEditActor } from './assembly-procedure-document-edit-lease.service.js';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getAssemblyProcedureAssetStorage } from '../assembly-procedure-assets/index.js';
import { AssemblyProcedureDocumentAssetsService, type AssemblyProcedureOverlayAssetDto } from './assembly-procedure-document-assets.service.js';
import { AssemblyTemplateAccessService } from './assembly-template-access.service.js';
import { normalizeElement } from './assembly-procedure-overlay.persistence.js';
import { runAssemblyTransaction } from './assembly-transaction.js';

export class ProcedureMaterialPlacementService {
  constructor(
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
    private readonly assets = new AssemblyProcedureDocumentAssetsService(),
    private readonly access = new AssemblyTemplateAccessService(),
  ) {}

  async place(params: AssemblyProcedureEditActor & { documentId: string; materialId: string; pageIndex: number; accessPassword?: string }) {
    await this.access.requireAccessPassword(params.accessPassword);
    let asset: AssemblyProcedureOverlayAssetDto | undefined;
    try {
      return await runAssemblyTransaction(async (tx) => {
        // Use the same document lock as overlay saves/publish/discard. Material
        // row locking also prevents duplicate uploads for concurrent placement.
        const documents = await tx.$queryRaw<Array<{ id: string; status: string; isActive: boolean; revisionRootId: string | null; isRevisionHead: boolean | null }>>`
          SELECT d."id", d."status", d."isActive", r."revisionRootId", r."isRevisionHead"
          FROM "AssemblyProcedureDocument" d
          LEFT JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
          WHERE d."id" = ${params.documentId} FOR UPDATE OF d
        `;
        const document = documents[0];
        if (!document) throw new ApiError(404, '手順書が見つかりません');
        await new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(params.documentId, params.holderKey ?? null, tx, params.holderToken ?? null);
        if (document.status !== 'DRAFT' || !document.isActive || !document.revisionRootId || !document.isRevisionHead) {
          throw new ApiError(409, '最新版の改版下書きだけ編集できます');
        }
        await tx.$queryRaw`SELECT "id" FROM "ProcedureMaterial" WHERE "id" = ${params.materialId} FOR UPDATE`;
        const material = await tx.procedureMaterial.findUnique({ where: { id: params.materialId } });
        if (!material) throw new ApiError(404, '素材がありません');
        if (material.documentId || material.placedAt || material.discardedAt) throw new ApiError(409, '未配置・未破棄の素材だけ配置できます');
        const page = await tx.assemblyProcedureDocumentPage.findUnique({ where: { documentId_pageIndex: { documentId: params.documentId, pageIndex: params.pageIndex } } });
        if (!page) throw new ApiError(400, '指定ページが存在しません');
        const last = await tx.assemblyProcedureOverlayElement.aggregate({ where: { documentId: params.documentId, pageIndex: params.pageIndex }, _max: { zIndex: true } });
        const base = { id: randomUUID(), pageIndex: params.pageIndex, zIndex: (last._max.zIndex ?? -1) + 1, opacity: 1, mask: { enabled: true, color: '#ffffff' } };
        let element: AssemblyProcedureOverlayElement;
        if (material.kind === 'PHOTO') {
          if (!material.storageKey || !material.contentType) throw new ApiError(400, '写真の原本がありません');
          const bytes = await this.store.read(material.storageKey, { verifyIntegrity: true });
          const photo = await sharp(bytes).rotate().metadata();
          const pageImage = await AssemblyProcedureImageStorage.readImage(page.imageRelativePath);
          const pageSize = await sharp(pageImage.buffer).metadata();
          const photoWidth = photo.autoOrient?.width ?? photo.width;
          const photoHeight = photo.autoOrient?.height ?? photo.height;
          if (!photoWidth || !photoHeight || !pageSize.width || !pageSize.height) throw new ApiError(400, '画像の寸法を取得できません');
          let widthRatio = 0.4;
          let heightRatio = widthRatio * photoHeight / photoWidth * pageSize.width / pageSize.height;
          if (heightRatio > 0.9) { widthRatio *= 0.9 / heightRatio; heightRatio = 0.9; }
          asset = await this.assets.uploadOverlayImage({ documentId: params.documentId, accessPassword: params.accessPassword, bytes, contentType: material.contentType, originalFileName: material.originalFileName, holderKey: params.holderKey, holderToken: params.holderToken }, tx);
          element = { ...base, kind: 'IMAGE', assetId: asset.assetId, objectFit: 'contain', bbox: { xRatio: (1 - widthRatio) / 2, yRatio: (1 - heightRatio) / 2, widthRatio, heightRatio } };
        } else {
          element = { ...base, kind: 'TEXT', text: material.text ?? '', bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.8, heightRatio: 0.2 }, style: { fontSizeRatio: 0.025, fontWeight: 'bold', color: '#0f172a', align: 'start' } };
        }
        // Validate the existing persistence contract before consuming the material.
        normalizeElement(element, 0);
        const updated = await tx.procedureMaterial.updateMany({ where: { id: material.id, documentId: null, placedAt: null, discardedAt: null }, data: { documentId: params.documentId, placedAt: new Date() } });
        if (!updated.count) throw new ApiError(409, '素材は既に配置または破棄されています');
        return { element, ...(asset ? { asset } : {}) };
      });
    } catch (error) {
      // A failed transaction never returned the new asset to the editor.
      if (asset) {
        await prisma.assemblyProcedureAsset.deleteMany({ where: { id: asset.assetId } });
        await getAssemblyProcedureAssetStorage().delete({ storageKey: asset.storageKey });
      }
      throw error;
    }
  }
}
