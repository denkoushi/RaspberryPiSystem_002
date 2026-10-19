import { runAssemblyTransaction } from './assembly-transaction.js';
import { AssemblyProcedureDocumentEditLeaseService, type AssemblyProcedureEditActor } from './assembly-procedure-document-edit-lease.service.js';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { projectOverlayBBoxToCrop, type OverlayRegionImage } from '@raspi-system/shared-types';
import { composeRegionImage } from '../assembly-procedure-assets/assembly-procedure-region-image.js';
import type { ImageOcrLayoutPort } from '../ocr/ports/image-ocr-layout.port.js';
import { logger } from '../../lib/logger.js';

import {
  cropAssemblyProcedureAssetRoi,
  CompositeTextCandidateAdapter,
  getAssemblyProcedureOverlayImageMaxBytes,
  getAssemblyProcedureAssetMaxBytes,
  normalizeAssemblyProcedureAssetRoi,
  getAssemblyProcedureAssetStorage,
  CoordinateOcrTextCandidateAdapter,
  groupAssemblyProcedureTextCandidates,
  PopplerBboxLayoutTextCandidateAdapter,
} from '../assembly-procedure-assets/index.js';
import type {
  AssemblyProcedureAssetStoragePort,
  AssemblyProcedureTextCandidate,
  AssemblyProcedureTextCandidatePort
} from '../assembly-procedure-assets/index.js';
import { getImageOcrLayoutPort } from '../ocr/image-ocr-runtime.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyTemplateAccessService } from './assembly-template-access.service.js';

export type AssemblyProcedureRegionBBox = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type AssemblyProcedureOverlayAssetDto = {
  assetId: string;
  storageKey: string;
  relativeUrl: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  kind: 'OVERLAY_IMAGE';
};

export type AssemblyProcedureDocumentAssetsServiceDeps = {
  storage?: AssemblyProcedureAssetStoragePort;
  textCandidates?: AssemblyProcedureTextCandidatePort;
  pdfTextCandidates?: AssemblyProcedureTextCandidatePort;
  layoutOcr?: ImageOcrLayoutPort;
  accessService?: AssemblyTemplateAccessService;
};

function extensionForContentType(contentType: string): string {
  switch (contentType.trim().toLowerCase()) {
    case 'image/png': return '.png';
    case 'image/webp': return '.webp';
    case 'image/tiff':
    case 'image/tif': return '.tiff';
    case 'image/jpeg':
    case 'image/jpg': return '.jpg';
    default: throw new ApiError(400, 'overlay画像はJPEG/PNG/WebP/TIFFのみ対応しています');
  }
}

function assertBytes(buffer: Buffer): void {
  if (!buffer.length) throw new ApiError(400, 'overlay画像が空です');
  if (buffer.length > getAssemblyProcedureOverlayImageMaxBytes()) {
    throw new ApiError(400, 'overlay画像が大きすぎます');
  }
}

function mapAsset(saved: {
  assetId: string;
  storageKey: string;
  relativeUrl: string;
  sha256: string;
  size: number;
  contentType: string;
}): AssemblyProcedureOverlayAssetDto {
  return {
    assetId: saved.assetId,
    storageKey: saved.storageKey,
    relativeUrl: saved.relativeUrl,
    sha256: saved.sha256,
    byteSize: saved.size,
    contentType: saved.contentType,
    kind: 'OVERLAY_IMAGE'
  };
}

function mapSourceBounds(
  candidates: AssemblyProcedureTextCandidate[],
  roi: AssemblyProcedureRegionBBox
): AssemblyProcedureTextCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    bounds: candidate.bounds
      ? {
          xRatio: roi.xRatio + candidate.bounds.xRatio * roi.widthRatio,
          yRatio: roi.yRatio + candidate.bounds.yRatio * roi.heightRatio,
          widthRatio: candidate.bounds.widthRatio * roi.widthRatio,
          heightRatio: candidate.bounds.heightRatio * roi.heightRatio
        }
      : null
  }));
}

export class AssemblyProcedureDocumentAssetsService {
  private readonly storage: AssemblyProcedureAssetStoragePort;
  private readonly textCandidates: AssemblyProcedureTextCandidatePort;
  private readonly accessService: AssemblyTemplateAccessService;

  constructor(deps: AssemblyProcedureDocumentAssetsServiceDeps = {}) {
    this.storage = deps.storage ?? getAssemblyProcedureAssetStorage();
    this.textCandidates = deps.textCandidates ?? new CompositeTextCandidateAdapter(
      new CoordinateOcrTextCandidateAdapter({
        runLayoutOcrOnImage: async (input) => {
          try {
            return await (deps.layoutOcr ?? getImageOcrLayoutPort()).runLayoutOcrOnImage(input);
          } catch (error) {
            logger.warn({ err: error }, 'assembly_procedure_region_ocr_failed');
            throw error;
          }
        }
      }),
      deps.pdfTextCandidates ?? new PopplerBboxLayoutTextCandidateAdapter(),
    );
    this.accessService = deps.accessService ?? new AssemblyTemplateAccessService();
  }

  private async assertEditable(documentId: string, accessPassword: string | undefined, db: Prisma.TransactionClient = prisma) {
    await this.accessService.requireAccessPassword(accessPassword);
    const document = await db.assemblyProcedureDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        status: true,
        isActive: true,
        revisionMetadata: {
          select: {
            revisionRootId: true,
            isRevisionHead: true,
            sourceAsset: {
              select: { kind: true, storageKey: true, contentType: true }
            }
          }
        }
      }
    });
    if (!document) throw new ApiError(404, '手順書が見つかりません');
    if (!document.revisionMetadata?.revisionRootId || document.status !== 'DRAFT' || !document.isActive || !document.revisionMetadata.isRevisionHead) {
      throw new ApiError(409, '最新版の改版下書きだけ編集できます');
    }
    return document;
  }

  private async withTemporarySourcePdf<T>(
    storageKey: string,
    operation: (pdfPath: string) => Promise<T>,
  ): Promise<T> {
    const bytes = await this.storage.read({ storageKey });
    if (!bytes.length || bytes.length > getAssemblyProcedureAssetMaxBytes()) {
      throw new Error('Source PDF is empty or exceeds the supported size');
    }
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'assembly-procedure-text-'));
    try {
      const pdfPath = path.join(temporaryDirectory, 'source.pdf');
      await writeFile(pdfPath, bytes, { flag: 'wx', mode: 0o600 });
      return await operation(pdfPath);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async pageImage(documentId: string, pageIndex: number) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new ApiError(400, 'ページ番号が不正です');
    const page = await prisma.assemblyProcedureDocumentPage.findUnique({
      where: { documentId_pageIndex: { documentId, pageIndex } },
      select: { imageRelativePath: true }
    });
    if (!page) throw new ApiError(400, '指定ページが存在しません');
    return AssemblyProcedureImageStorage.readImage(page.imageRelativePath);
  }

  async uploadOverlayImage(params: AssemblyProcedureEditActor & {
    documentId: string;
    accessPassword?: string;
    bytes: Buffer;
    contentType: string;
    originalFileName?: string | null;
  }, db?: Prisma.TransactionClient): Promise<AssemblyProcedureOverlayAssetDto> {
    if (!db) return runAssemblyTransaction((tx) => this.uploadOverlayImage(params, tx));
    await db.$queryRaw`SELECT id FROM "AssemblyProcedureDocument" WHERE id = ${params.documentId} FOR UPDATE`;
    await new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(params.documentId, params.holderKey ?? null, db, params.holderToken ?? null);
    await this.assertEditable(params.documentId, params.accessPassword, db);
    assertBytes(params.bytes);
    const contentType = params.contentType.trim().toLowerCase();
    const saved = await this.storage.save({
      data: params.bytes,
      contentType,
      extension: extensionForContentType(contentType)
    });
    try {
      await db.assemblyProcedureAsset.create({
        data: {
          id: saved.assetId,
          kind: 'OVERLAY_IMAGE',
          storageKey: saved.storageKey,
          sha256: saved.sha256,
          byteSize: saved.size,
          contentType: saved.contentType,
          ownerDocumentId: params.documentId,
          originalFileName: params.originalFileName?.trim() || null
        }
      });
      return mapAsset(saved);
    } catch (error) {
      await this.storage.delete(saved).catch(() => undefined);
      throw error;
    }
  }

  private async regionAssets(
    documentId: string,
    revisionRootId: string,
    overlays: readonly OverlayRegionImage[],
    roi: AssemblyProcedureRegionBBox,
    db: Prisma.TransactionClient = prisma
  ): Promise<Map<string, string>> {
    if (!overlays.length) return new Map();
    const ids = [...new Set(overlays.map(({ assetId }) => assetId))];
    const assets = await db.assemblyProcedureAsset.findMany({
      where: { id: { in: ids }, kind: 'OVERLAY_IMAGE' },
      select: { id: true, ownerDocumentId: true, storageKey: true, contentType: true }
    });
    const unownedIds = assets.filter((asset) => asset.ownerDocumentId !== documentId).map((asset) => asset.id);
    const references = unownedIds.length ? await db.assemblyProcedureOverlayElement.findMany({
      where: {
        assetId: { in: unownedIds },
        kind: 'IMAGE',
        document: { revisionMetadata: { is: { revisionRootId } } }
      },
      select: { assetId: true },
      distinct: ['assetId']
    }) : [];
    const referencedIds = new Set(references.map(({ assetId }) => assetId));
    // Released assets must still be referenced by a saved IMAGE in this revision family.
    if (assets.length !== ids.length || assets.some((asset) =>
      (asset.ownerDocumentId !== documentId && !referencedIds.has(asset.id)) ||
      !asset.contentType.startsWith('image/'))) {
      throw new ApiError(400, 'overlay画像assetが存在しないか、この文書では使用できません');
    }
    const intersectingIds = new Set(overlays
      .filter(({ bbox }) => projectOverlayBBoxToCrop(bbox, roi) !== null)
      .map(({ assetId }) => assetId));
    const storageKeys = new Map<string, string>();
    for (const asset of assets) {
      if (intersectingIds.has(asset.id)) {
        storageKeys.set(asset.id, asset.storageKey);
      }
    }
    return storageKeys;
  }

  private async regionImage(
    pageBuffer: Buffer,
    roi: AssemblyProcedureRegionBBox,
    overlays: readonly OverlayRegionImage[],
    storageKeys: ReadonlyMap<string, string>
  ) {
    try {
      if (!overlays.length) return await cropAssemblyProcedureAssetRoi(pageBuffer, roi);
      const assets = new Map<string, Buffer>();
      for (const [assetId, storageKey] of storageKeys) {
        assets.set(assetId, await this.storage.read({ storageKey }));
      }
      return await composeRegionImage({ pageBuffer, roi, overlays, assets });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Input image exceeds pixel limit')) {
        throw new ApiError(400, '画像の画素数が大きすぎます');
      }
      throw error;
    }
  }

  async createImageRegion(params: AssemblyProcedureEditActor & {
    documentId: string;
    accessPassword?: string;
    pageIndex: number;
    bbox: AssemblyProcedureRegionBBox;
    overlays?: OverlayRegionImage[];
  }, db?: Prisma.TransactionClient): Promise<AssemblyProcedureOverlayAssetDto> {
    if (!db) return runAssemblyTransaction((tx) => this.createImageRegion(params, tx));
    await db.$queryRaw`SELECT id FROM "AssemblyProcedureDocument" WHERE id = ${params.documentId} FOR UPDATE`;
    await new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(params.documentId, params.holderKey ?? null, db, params.holderToken ?? null);
    const editable = await this.assertEditable(params.documentId, params.accessPassword, db);
    let roi: ReturnType<typeof normalizeAssemblyProcedureAssetRoi>;
    try {
      roi = normalizeAssemblyProcedureAssetRoi(params.bbox);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'ROIが不正です');
    }
    const source = await this.pageImage(params.documentId, params.pageIndex);
    const storageKeys = await this.regionAssets(params.documentId, editable.revisionMetadata!.revisionRootId, params.overlays ?? [], roi, db);
    const cropped = await this.regionImage(source.buffer, roi, params.overlays ?? [], storageKeys);
    const saved = await this.storage.save({
      data: cropped.buffer,
      contentType: cropped.contentType,
      extension: '.jpg'
    });
    try {
      await db.assemblyProcedureAsset.create({
        data: {
          id: saved.assetId,
          kind: 'OVERLAY_IMAGE',
          storageKey: saved.storageKey,
          sha256: saved.sha256,
          byteSize: saved.size,
          contentType: saved.contentType,
          ownerDocumentId: params.documentId,
          width: cropped.width,
          height: cropped.height
        }
      });
      return mapAsset(saved);
    } catch (error) {
      await this.storage.delete(saved).catch(() => undefined);
      throw error;
    }
  }

  async findTextCandidates(params: {
    documentId: string;
    accessPassword?: string;
    pageIndex: number;
    bbox: AssemblyProcedureRegionBBox;
    overlays?: OverlayRegionImage[];
  }): Promise<AssemblyProcedureTextCandidate[]> {
    const editable = await this.assertEditable(params.documentId, params.accessPassword);
    let roi: ReturnType<typeof normalizeAssemblyProcedureAssetRoi>;
    try {
      roi = normalizeAssemblyProcedureAssetRoi(params.bbox);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'ROIが不正です');
    }

    const storageKeys = await this.regionAssets(params.documentId, editable.revisionMetadata!.revisionRootId, params.overlays ?? [], roi);
    const sourceAsset = editable.revisionMetadata?.sourceAsset;
    const isPdfSource =
      sourceAsset?.kind === 'SOURCE' &&
      sourceAsset.contentType.trim().toLowerCase() === 'application/pdf';
    if (isPdfSource) {
      try {
        const candidates = await this.withTemporarySourcePdf(
          sourceAsset.storageKey,
          (pdfPath) =>
            this.textCandidates.extractCandidates({
              pdfPath,
              pageIndex: params.pageIndex,
              roi,
            }),
        );
        if (candidates.length > 0) {
          let roiAspectRatio = 1;
          try {
            const source = await this.pageImage(params.documentId, params.pageIndex);
            const metadata = await sharp(source.buffer, { failOn: 'none', limitInputPixels: 40_000_000 }).metadata();
            const pageWidth = metadata.width ?? 0;
            const pageHeight = metadata.height ?? 0;
            if (pageWidth > 0 && pageHeight > 0) {
              roiAspectRatio =
                (pageWidth * roi.widthRatio) / (pageHeight * roi.heightRatio);
            }
          } catch (error) {
            if (error instanceof Error && error.message.includes('Input image exceeds pixel limit')) {
              throw new ApiError(400, '画像の画素数が大きすぎます');
            }
            // Keep valid Poppler candidates when the preview image is unavailable.
          }
          return mapSourceBounds(
            groupAssemblyProcedureTextCandidates(candidates, roiAspectRatio),
            roi,
          );
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        // A missing/invalid source PDF is recoverable through image OCR below.
      }
    }

    const source = await this.pageImage(params.documentId, params.pageIndex);
    try {
      const cropped = await this.regionImage(source.buffer, roi, params.overlays ?? [], storageKeys);
      const imageBytes = params.overlays?.length
        ? await sharp(cropped.buffer, { limitInputPixels: 40_000_000 })
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
          .jpeg().toBuffer()
        : cropped.buffer;
      const candidates = await this.textCandidates.extractCandidates({
        imageBytes,
        imageMimeType: 'image/jpeg',
        pageIndex: params.pageIndex,
        roi,
      });
      const grouped = groupAssemblyProcedureTextCandidates(
        params.overlays?.length ? candidates.map((candidate) => ({
          ...candidate,
          source: 'ocr' as const,
          confidence: candidate.confidence === null ? null : Math.min(1, Math.max(0, candidate.confidence / 100))
        })) : candidates,
        cropped.width / cropped.height,
      );
      // Preserve legacy candidate metadata/choices when the additive input is omitted.
      return mapSourceBounds(
        params.overlays?.length ? grouped.filter((candidate) => !candidate.text.includes('\n')) : grouped,
        roi,
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.warn({ err: error, documentId: params.documentId, pageIndex: params.pageIndex }, 'assembly_procedure_region_ocr_failed');
      return [];
    }
  }
}
