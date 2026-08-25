import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

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
      new CoordinateOcrTextCandidateAdapter(getImageOcrLayoutPort()),
      deps.pdfTextCandidates ?? new PopplerBboxLayoutTextCandidateAdapter(),
    );
    this.accessService = deps.accessService ?? new AssemblyTemplateAccessService();
  }

  private async assertEditable(documentId: string, accessPassword: string | undefined) {
    await this.accessService.requireAccessPassword(accessPassword);
    const document = await prisma.assemblyProcedureDocument.findUnique({
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

  async uploadOverlayImage(params: {
    documentId: string;
    accessPassword?: string;
    bytes: Buffer;
    contentType: string;
    originalFileName?: string | null;
  }): Promise<AssemblyProcedureOverlayAssetDto> {
    await this.assertEditable(params.documentId, params.accessPassword);
    assertBytes(params.bytes);
    const contentType = params.contentType.trim().toLowerCase();
    const saved = await this.storage.save({
      data: params.bytes,
      contentType,
      extension: extensionForContentType(contentType)
    });
    try {
      await prisma.assemblyProcedureAsset.create({
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

  async createImageRegion(params: {
    documentId: string;
    accessPassword?: string;
    pageIndex: number;
    bbox: AssemblyProcedureRegionBBox;
  }): Promise<AssemblyProcedureOverlayAssetDto> {
    await this.assertEditable(params.documentId, params.accessPassword);
    let roi: ReturnType<typeof normalizeAssemblyProcedureAssetRoi>;
    try {
      roi = normalizeAssemblyProcedureAssetRoi(params.bbox);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'ROIが不正です');
    }
    const source = await this.pageImage(params.documentId, params.pageIndex);
    const cropped = await cropAssemblyProcedureAssetRoi(source.buffer, roi);
    const saved = await this.storage.save({
      data: cropped.buffer,
      contentType: cropped.contentType,
      extension: '.jpg'
    });
    try {
      await prisma.assemblyProcedureAsset.create({
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
  }): Promise<AssemblyProcedureTextCandidate[]> {
    const editable = await this.assertEditable(params.documentId, params.accessPassword);
    let roi: ReturnType<typeof normalizeAssemblyProcedureAssetRoi>;
    try {
      roi = normalizeAssemblyProcedureAssetRoi(params.bbox);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'ROIが不正です');
    }

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
            const metadata = await sharp(source.buffer, { failOn: 'none' }).metadata();
            const pageWidth = metadata.width ?? 0;
            const pageHeight = metadata.height ?? 0;
            if (pageWidth > 0 && pageHeight > 0) {
              roiAspectRatio =
                (pageWidth * roi.widthRatio) / (pageHeight * roi.heightRatio);
            }
          } catch {
            // Keep valid Poppler candidates when the preview image is unavailable.
          }
          return mapSourceBounds(
            groupAssemblyProcedureTextCandidates(candidates, roiAspectRatio),
            roi,
          );
        }
      } catch {
        // A missing/invalid source PDF is recoverable through image OCR below.
      }
    }

    const source = await this.pageImage(params.documentId, params.pageIndex);
    try {
      const cropped = await cropAssemblyProcedureAssetRoi(source.buffer, roi);
      const candidates = await this.textCandidates.extractCandidates({
        imageBytes: cropped.buffer,
        imageMimeType: 'image/jpeg',
        pageIndex: params.pageIndex,
        roi,
      });
      return mapSourceBounds(
        groupAssemblyProcedureTextCandidates(
          candidates,
          cropped.width / cropped.height,
        ),
        roi,
      );
    } catch {
      return [];
    }
  }
}
