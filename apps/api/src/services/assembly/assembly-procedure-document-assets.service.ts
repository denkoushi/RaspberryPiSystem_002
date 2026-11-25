import { runAssemblyTransaction } from './assembly-transaction.js';
import { AssemblyProcedureDocumentEditLeaseService, type AssemblyProcedureEditActor } from './assembly-procedure-document-edit-lease.service.js';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { projectOverlayBBoxToCrop, type AssemblyProcedureOverlayAssetMetadata, type OverlayRegionImage } from '@raspi-system/shared-types';
import { assemblyProcedureAssetRoiToPixels, type AssemblyProcedureAssetPixelRoi } from '../assembly-procedure-assets/assembly-procedure-asset-roi.js';
import { composeRegionImage, composeRegionRgb } from '../assembly-procedure-assets/assembly-procedure-region-image.js';
import { padPixels, pixelsToBox, selectRewriteText, unionBoxes } from '../assembly-procedure-assets/assembly-procedure-text-rewrite.js';
import { eraseText } from '../image-region/text-erase.js';
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
  StoredAssemblyProcedureAsset,
  AssemblyProcedureTextCandidate,
  AssemblyProcedureTextCandidatePort
} from '../assembly-procedure-assets/index.js';
import { getImageOcrLayoutPort } from '../ocr/image-ocr-runtime.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyTemplateAccessService } from './assembly-template-access.service.js';
import { readableOverlayAssets, rotateOverlayImageBytes } from './assembly-procedure-overlay-image-access.js';

export type AssemblyProcedureRegionBBox = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type AssemblyProcedureOverlayAssetDto = AssemblyProcedureOverlayAssetMetadata & {
  relativeUrl: string;
  sha256: string;
  kind: 'OVERLAY_IMAGE';
};

export type AssemblyProcedureDocumentAssetsServiceDeps = {
  storage?: AssemblyProcedureAssetStoragePort;
  textCandidates?: AssemblyProcedureTextCandidatePort;
  pdfTextCandidates?: AssemblyProcedureTextCandidatePort;
  layoutOcr?: ImageOcrLayoutPort;
  accessService?: AssemblyTemplateAccessService;
};

type DocumentEditParams = AssemblyProcedureEditActor & {
  documentId: string;
  accessPassword?: string;
};

type RegionParams = DocumentEditParams & {
  pageIndex: number;
  bbox: AssemblyProcedureRegionBBox;
  overlays?: OverlayRegionImage[];
};

const PHOTO_SHARPEN_OPTIONS = { sigma: 1.2, m1: 1, m2: 2.5 };
const PHOTO_SHARPEN_OUTPUT = {
  'image/jpeg': (image: ReturnType<typeof sharp>) => image.jpeg({ quality: 92 }),
  'image/png': (image: ReturnType<typeof sharp>) => image.png(),
  'image/webp': (image: ReturnType<typeof sharp>) => image.webp(),
  'image/tiff': (image: ReturnType<typeof sharp>) => image.tiff()
};

const FULL_PAGE = { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 };
const MAX_TEXT_REWRITE_PIXELS = 4_000_000;
const MIN_REWRITE_PATCH_MARGIN = 6;
const MIN_REWRITE_CONTEXT_MARGIN = 24;

function assertTextRewritePixelLimit({ width, height }: AssemblyProcedureAssetPixelRoi) {
  if (width * height > MAX_TEXT_REWRITE_PIXELS) {
    throw new ApiError(422, '範囲が広すぎます。文字の行を囲んでください');
  }
}

function normalizeRegion(bbox: AssemblyProcedureRegionBBox) {
  try {
    return normalizeAssemblyProcedureAssetRoi(bbox);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'ROIが不正です');
  }
}

async function pageDimensions(buffer: Buffer) {
  try {
    const metadata = await sharp(buffer, { failOn: 'none', limitInputPixels: 40_000_000 }).metadata();
    return { width: metadata.width ?? 0, height: metadata.height ?? 0 };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Input image exceeds pixel limit')) {
      throw new ApiError(400, '画像の画素数が大きすぎます');
    }
    throw error;
  }
}

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

function mapAsset(saved: StoredAssemblyProcedureAsset): AssemblyProcedureOverlayAssetDto {
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

  private async assertEditable(documentId: string, accessPassword: string | undefined, db: Prisma.TransactionClient = prisma, caller: AssemblyProcedureEditActor = {}) {
    await this.accessService.requireAccessPassword(accessPassword, caller);
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

  private async pageImagePath(documentId: string, pageIndex: number, db: Prisma.TransactionClient = prisma) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new ApiError(400, 'ページ番号が不正です');
    const page = await db.assemblyProcedureDocumentPage.findUnique({
      where: { documentId_pageIndex: { documentId, pageIndex } },
      select: { imageRelativePath: true }
    });
    if (!page) throw new ApiError(400, '指定ページが存在しません');
    return page.imageRelativePath;
  }

  private async pageImage(documentId: string, pageIndex: number) {
    return AssemblyProcedureImageStorage.readImage(await this.pageImagePath(documentId, pageIndex));
  }

  private async lockEditableDocument(params: DocumentEditParams, db: Prisma.TransactionClient) {
    await db.$queryRaw`SELECT id FROM "AssemblyProcedureDocument" WHERE id = ${params.documentId} FOR UPDATE`;
    await new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(params.documentId, params.holderKey ?? null, db, params.holderToken ?? null);
    return this.assertEditable(params.documentId, params.accessPassword, db, params);
  }

  async uploadOverlayImage(params: DocumentEditParams & {
    bytes: Buffer;
    contentType: string;
    originalFileName?: string | null;
  }, db?: Prisma.TransactionClient): Promise<AssemblyProcedureOverlayAssetDto> {
    if (!db) return runAssemblyTransaction((tx) => this.uploadOverlayImage(params, tx));
    await this.lockEditableDocument(params, db);
    const saved = await this.saveOverlayBlob(params.bytes, params.contentType);
    try {
      await this.createOwnedOverlayAsset(saved, params.documentId, db, {
        originalFileName: params.originalFileName?.trim() || null
      });
      return mapAsset(saved);
    } catch (error) {
      await this.storage.delete(saved).catch(() => undefined);
      throw error;
    }
  }

  private saveOverlayBlob(bytes: Buffer, inputContentType: string) {
    assertBytes(bytes);
    const contentType = inputContentType.trim().toLowerCase();
    return this.storage.save({ data: bytes, contentType, extension: extensionForContentType(contentType) });
  }

  private createOwnedOverlayAsset(
    saved: StoredAssemblyProcedureAsset,
    documentId: string,
    db: Prisma.TransactionClient,
    metadata: Pick<Prisma.AssemblyProcedureAssetUncheckedCreateInput, 'originalFileName' | 'derivedFromAssetId' | 'width' | 'height'>
  ) {
    return db.assemblyProcedureAsset.create({
      data: {
        ...metadata,
        id: saved.assetId,
        kind: 'OVERLAY_IMAGE',
        storageKey: saved.storageKey,
        sha256: saved.sha256,
        byteSize: saved.size,
        contentType: saved.contentType,
        ownerDocumentId: documentId
      }
    });
  }

  async sharpenOverlayImage(params: DocumentEditParams & { assetId: string }) {
    let saved: StoredAssemblyProcedureAsset | undefined;
    try {
      return await runAssemblyTransaction(async (db) => {
        await this.lockEditableDocument(params, db);
        const source = await db.assemblyProcedureAsset.findFirst({
          where: {
            id: params.assetId,
            kind: 'OVERLAY_IMAGE',
            OR: [
              { ownerDocumentId: params.documentId },
              { overlayElements: { some: { documentId: params.documentId, kind: 'IMAGE' } } },
              // Restored in the editor but not saved yet: the draft still points at its sharpened copy.
              {
                derivedAssets: {
                  some: {
                    OR: [
                      { ownerDocumentId: params.documentId },
                      { overlayElements: { some: { documentId: params.documentId, kind: 'IMAGE' } } }
                    ]
                  }
                }
              }
            ]
          },
          select: { id: true, storageKey: true, contentType: true, derivedFromAssetId: true }
        });
        if (!source) throw new ApiError(404, 'この下書きの画像が見つかりません');
        if (source.derivedFromAssetId) throw new ApiError(409, 'この写真はすでにくっきり処理されています');
        // Hold the source row through the FK insert, including while Sharp reads the blob.
        const locked = await db.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "AssemblyProcedureAsset" WHERE "id" = ${source.id} FOR KEY SHARE
        `;
        if (!locked.length) throw new ApiError(404, 'この下書きの画像が見つかりません');
        const contentType = source.contentType;
        if (!Object.hasOwn(PHOTO_SHARPEN_OUTPUT, contentType)) {
          throw new ApiError(400, 'この画像形式はくっきり処理に対応していません');
        }
        const bytes = await this.storage.read(source);
        assertBytes(bytes);
        const image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().sharpen(PHOTO_SHARPEN_OPTIONS);
        const output = PHOTO_SHARPEN_OUTPUT[contentType as keyof typeof PHOTO_SHARPEN_OUTPUT](image);
        const { data, info } = await output.toBuffer({ resolveWithObject: true }).catch((error: unknown) => {
          const message = error instanceof Error && error.message.includes('Input image exceeds pixel limit')
            ? '画像の画素数が大きすぎます' : '写真をくっきりできませんでした';
          throw new ApiError(400, message);
        });
        saved = await this.saveOverlayBlob(data, contentType);
        await this.createOwnedOverlayAsset(saved, params.documentId, db, {
          derivedFromAssetId: source.id, width: info.width, height: info.height
        });
        return { ...mapAsset(saved), derivedFromAssetId: source.id };
      });
    } catch (error) {
      if (saved) await this.storage.delete(saved).catch(() => undefined);
      throw error;
    }
  }

  async rotateOverlayImage(params: DocumentEditParams & {
    assetId: string;
    direction: 'left' | 'right';
  }): Promise<AssemblyProcedureOverlayAssetDto & { originalAsset?: AssemblyProcedureOverlayAssetDto }> {
    const savedBlobs: StoredAssemblyProcedureAsset[] = [];
    try {
      return await runAssemblyTransaction(async (db) => {
        const editable = await this.lockEditableDocument(params, db);
        const [source] = await readableOverlayAssets(
          params.documentId, editable.revisionMetadata!.revisionRootId, [params.assetId], db
        );
        const [original, rotatedBlob] = await Promise.all([
          source.derivedFromAsset && this.rotateOverlayBlob(source.derivedFromAsset, params.direction),
          this.rotateOverlayBlob(source, params.direction)
        ]);
        const saveAsset = async ({ bytes, contentType }: Awaited<ReturnType<typeof this.rotateOverlayBlob>>, derivedFromAssetId?: string) => {
          const saved = await this.saveOverlayBlob(bytes, contentType);
          savedBlobs.push(saved);
          await this.createOwnedOverlayAsset(saved, params.documentId, db, { derivedFromAssetId });
          return mapAsset(saved);
        };
        // Restore must keep the new orientation even when sharpening is turned off.
        const originalAsset = original ? await saveAsset(original) : undefined;
        const rotated = await saveAsset(rotatedBlob, originalAsset?.assetId);
        return originalAsset ? { ...rotated, derivedFromAssetId: originalAsset.assetId, originalAsset } : rotated;
      });
    } catch (error) {
      await Promise.allSettled(savedBlobs.map(saved => this.storage.delete(saved)));
      throw error;
    }
  }

  private async rotateOverlayBlob(source: { storageKey: string }, direction: 'left' | 'right') {
    const original = await this.storage.read(source);
    assertBytes(original);
    return rotateOverlayImageBytes(original, direction);
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
    const assets = await readableOverlayAssets(documentId, revisionRootId, ids, db);
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

  private async loadRegionAssets(storageKeys: ReadonlyMap<string, string>) {
    const assets = new Map<string, Buffer>();
    for (const [assetId, storageKey] of storageKeys) {
      assets.set(assetId, await this.storage.read({ storageKey }));
    }
    return assets;
  }

  private async regionImage(
    pageBuffer: Buffer,
    roi: AssemblyProcedureRegionBBox,
    overlays: readonly OverlayRegionImage[],
    storageKeys: ReadonlyMap<string, string>,
    photoOnly = false
  ) {
    try {
      if (!overlays.length) return await cropAssemblyProcedureAssetRoi(pageBuffer, roi);
      return await composeRegionImage({ pageBuffer, roi, overlays, assets: await this.loadRegionAssets(storageKeys), photoOnly });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Input image exceeds pixel limit')) {
        throw new ApiError(400, '画像の画素数が大きすぎます');
      }
      throw error;
    }
  }

  async createImageRegion(params: RegionParams, db?: Prisma.TransactionClient): Promise<AssemblyProcedureOverlayAssetDto> {
    if (!db) return runAssemblyTransaction((tx) => this.createImageRegion(params, tx));
    const editable = await this.lockEditableDocument(params, db);
    const roi = normalizeRegion(params.bbox);
    const source = await this.pageImage(params.documentId, params.pageIndex);
    const storageKeys = await this.regionAssets(params.documentId, editable.revisionMetadata!.revisionRootId, params.overlays ?? [], roi, db);
    const cropped = await this.regionImage(source.buffer, roi, params.overlays ?? [], storageKeys);
    return this.saveRegionAsset(params.documentId, cropped, db);
  }

  private async saveRegionAsset(
    documentId: string,
    cropped: { buffer: Buffer; width: number; height: number; contentType: 'image/jpeg' },
    db: Prisma.TransactionClient
  ) {
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
          ownerDocumentId: documentId,
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

  async createTextRewriteRegion(params: RegionParams) {
    await new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(
      params.documentId, params.holderKey ?? null, undefined, params.holderToken ?? null
    );
    const editable = await this.assertEditable(params.documentId, params.accessPassword, prisma, params);
    const selection = normalizeRegion(params.bbox);
    const pagePath = await this.pageImagePath(params.documentId, params.pageIndex);
    const source = await AssemblyProcedureImageStorage.readImage(pagePath);
    const { width, height } = await pageDimensions(source.buffer);
    const selectionPixels = assemblyProcedureAssetRoiToPixels(selection, width, height);
    // Both margins can grow after text detection, so check their minimum before OCR.
    assertTextRewritePixelLimit(padPixels(selectionPixels, MIN_REWRITE_PATCH_MARGIN + MIN_REWRITE_CONTEXT_MARGIN, width, height));
    // OCR on a band can read complete lines even when the selection intersects
    // only one word. For PDFs the source layout already covers the whole page.
    const band = padPixels(selectionPixels, Math.max(selectionPixels.height, 48), width, height);
    const searchRoi = pixelsToBox({ ...band, left: 0, width }, width, height);
    const candidates = await this.extractRegionCandidates(params, editable, searchRoi, {
      selection, pageBuffer: source.buffer, width, height
    });
    const selected = selectRewriteText(candidates, selection, width, height);
    if (!selected) throw new ApiError(422, '文字が見つかりませんでした');

    const { bounds, textBBox, text, fontSizeRatio } = selected;
    const textHeight = Math.max(...bounds.map((box) => box.heightRatio * height));
    const union = assemblyProcedureAssetRoiToPixels(unionBoxes(selection, textBBox), width, height);
    const patch = padPixels(union, Math.max(MIN_REWRITE_PATCH_MARGIN, Math.ceil(textHeight * 0.25)), width, height);
    const context = padPixels(patch, Math.max(MIN_REWRITE_CONTEXT_MARGIN, Math.ceil(textHeight)), width, height);
    assertTextRewritePixelLimit(context);
    const patchBBox = pixelsToBox(patch, width, height);
    const contextBBox = pixelsToBox(context, width, height);
    const overlays = params.overlays ?? [];
    const storageKeys = await this.regionAssets(params.documentId, editable.revisionMetadata!.revisionRootId, overlays, contextBBox);
    const rgb = await composeRegionRgb({
      pageBuffer: source.buffer, roi: contextBBox, overlays, assets: await this.loadRegionAssets(storageKeys)
    }, context, width, height);
    const inContext = (box: typeof patch) => ({ ...box, left: box.left - context.left, top: box.top - context.top });
    const erase = inContext(patch);
    const erased = eraseText({
      width: context.width,
      height: context.height,
      rgb,
      erase,
      candidates: bounds.map((box) => inContext(assemblyProcedureAssetRoiToPixels(box, width, height)))
    });
    const buffer = await sharp(erased.rgb, {
      raw: { width: context.width, height: context.height, channels: 3 }
    }).extract(erase).jpeg({ quality: 90 }).toBuffer();

    // OCR may outlast a transaction. Recheck write access and the page identity
    // under the same lock as image-region creation before storing the patch.
    const asset = await runAssemblyTransaction(async (db) => {
      const current = await this.lockEditableDocument(params, db);
      if (await this.pageImagePath(params.documentId, params.pageIndex, db) !== pagePath ||
          current.revisionMetadata?.sourceAsset?.storageKey !== editable.revisionMetadata?.sourceAsset?.storageKey) {
        throw new ApiError(409, 'ページが更新されました。選択し直してください。');
      }
      await this.regionAssets(params.documentId, current.revisionMetadata!.revisionRootId, overlays, contextBBox, db);
      return this.saveRegionAsset(params.documentId, { buffer, width: patch.width, height: patch.height, contentType: 'image/jpeg' }, db);
    });
    return { asset, patchBBox, text, textBBox, color: erased.color, fontSizeRatio };
  }

  async findTextCandidates(params: RegionParams & { photoOnly?: boolean }): Promise<AssemblyProcedureTextCandidate[]> {
    const editable = await this.assertEditable(params.documentId, params.accessPassword, prisma, params);
    const roi = normalizeRegion(params.bbox);
    if (params.photoOnly && (params.overlays?.length !== 1 || !projectOverlayBBoxToCrop(params.overlays[0].bbox, roi))) {
      throw new ApiError(400, '読み取る写真を1件指定してください');
    }
    return this.extractRegionCandidates(params, editable, roi);
  }

  private async extractRegionCandidates(
    params: RegionParams & { photoOnly?: boolean },
    editable: Awaited<ReturnType<AssemblyProcedureDocumentAssetsService['assertEditable']>>,
    roi: AssemblyProcedureRegionBBox,
    rewrite?: { selection: AssemblyProcedureRegionBBox; pageBuffer: Buffer; width: number; height: number }
  ): Promise<AssemblyProcedureTextCandidate[]> {
    const storageKeys = await this.regionAssets(params.documentId, editable.revisionMetadata!.revisionRootId, params.overlays ?? [], roi);
    const sourceAsset = editable.revisionMetadata?.sourceAsset;
    const isPdfSource =
      sourceAsset?.kind === 'SOURCE' &&
      sourceAsset.contentType.trim().toLowerCase() === 'application/pdf';
    const selectionHasOverlay = rewrite && params.overlays?.some(({ bbox }) =>
      projectOverlayBBoxToCrop(bbox, rewrite.selection) !== null);
    if (isPdfSource && !selectionHasOverlay && !params.photoOnly) {
      try {
        const candidates = await this.withTemporarySourcePdf(
          sourceAsset.storageKey,
          (pdfPath) =>
            this.textCandidates.extractCandidates({
              pdfPath,
              pageIndex: params.pageIndex,
              roi: rewrite ? FULL_PAGE : roi,
            }),
        );
        if (rewrite) {
          if (candidates.some(({ bounds }) => bounds && projectOverlayBBoxToCrop(bounds, rewrite.selection))) {
            return candidates;
          }
        } else if (candidates.length > 0) {
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

    const pageBuffer = rewrite?.pageBuffer ?? (await this.pageImage(params.documentId, params.pageIndex)).buffer;
    try {
      const cropped = await this.regionImage(pageBuffer, roi, params.overlays ?? [], storageKeys, params.photoOnly);
      const imageBytes = !rewrite && params.overlays?.length
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
      if (rewrite) {
        return mapSourceBounds(candidates, pixelsToBox(cropped.pixelRoi, rewrite.width, rewrite.height));
      }
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
