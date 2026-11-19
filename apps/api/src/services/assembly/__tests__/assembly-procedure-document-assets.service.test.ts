import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(), $transaction: vi.fn(),
    assemblyProcedureDocument: { findUnique: vi.fn() },
    assemblyProcedureDocumentPage: { findUnique: vi.fn() },
    assemblyProcedureOverlayElement: { findMany: vi.fn() },
    assemblyProcedureAsset: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() }
  },
  pageImage: vi.fn(), warn: vi.fn()
}));
vi.mock('../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('../../../lib/assembly-procedure-image-storage.js', () => ({
  AssemblyProcedureImageStorage: { readImage: mocks.pageImage }
}));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../assembly-procedure-document-edit-lease.service.js', () => ({
  AssemblyProcedureDocumentEditLeaseService: class { async assertCanWrite() {} }
}));

import { cropAssemblyProcedureAssetRoi } from '../../assembly-procedure-assets/assembly-procedure-asset-roi.js';

import { AssemblyProcedureDocumentAssetsService } from '../assembly-procedure-document-assets.service.js';

const full = { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 };
const roi = { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.5 };
const overlay = { assetId: 'material', bbox: full, zIndex: 0 };
const params = { documentId: 'draft', accessPassword: '1234', pageIndex: 0, bbox: roi, overlays: [overlay] };
const document = {
  id: 'draft', status: 'DRAFT', isActive: true,
  revisionMetadata: { revisionRootId: 'root', isRevisionHead: true, sourceAsset: null }
};
const image = (color: string, width = 100, height = 100) => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
const layoutOcr = { runLayoutOcrOnImage: vi.fn() };
const pdfTextCandidates = { extractCandidates: vi.fn() };
const storage = { initialize: vi.fn(), save: vi.fn(), read: vi.fn(), stat: vi.fn(), delete: vi.fn() };
const service = () => new AssemblyProcedureDocumentAssetsService({
  storage, layoutOcr, pdfTextCandidates,
  accessService: { requireAccessPassword: vi.fn() } as never
});

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.db.$transaction.mockImplementation(async (work) => work(mocks.db));
  mocks.db.assemblyProcedureDocument.findUnique.mockResolvedValue(document);
  mocks.db.assemblyProcedureDocumentPage.findUnique.mockResolvedValue({ imageRelativePath: 'page.png' });
  mocks.pageImage.mockResolvedValue({ buffer: await image('white') });
  mocks.db.assemblyProcedureAsset.findMany.mockResolvedValue([{
    id: 'material', ownerDocumentId: 'draft', storageKey: 'material.png', contentType: 'image/png'
  }]);
  mocks.db.assemblyProcedureOverlayElement.findMany.mockResolvedValue([]);
  storage.read.mockResolvedValue(await image('red'));
  storage.delete.mockResolvedValue(undefined);
  storage.save.mockResolvedValue({ assetId: 'crop', storageKey: 'crop.jpg', relativeUrl: '/crop.jpg', contentType: 'image/jpeg', size: 100, sha256: 'hash' });
  pdfTextCandidates.extractCandidates.mockResolvedValue([]);
  layoutOcr.runLayoutOcrOnImage.mockResolvedValue({ text: '', engine: 'mock', words: [] });
});

describe('rotate overlay image', () => {
  it.each([['left', 20], ['right', 50]] as const)('rotates PNG %s and creates a new owned asset without changing the source', async (direction, firstRed) => {
    const pixels = Buffer.from([10, 20, 30, 40, 50, 60].flatMap(red => [red, 100, 200, 128]));
    const original = await sharp(pixels, { raw: { width: 2, height: 3, channels: 4 } }).png().toBuffer();
    storage.read.mockResolvedValue(original);
    storage.save.mockResolvedValue({ assetId: 'rotated', storageKey: 'rotated.png', relativeUrl: '/rotated.png', contentType: 'image/png', size: 100, sha256: 'hash' });

    await expect(service().rotateOverlayImage({ documentId: 'draft', assetId: 'material', direction })).resolves.toMatchObject({
      assetId: 'rotated', contentType: 'image/png', kind: 'OVERLAY_IMAGE'
    });
    const [saved] = storage.save.mock.calls[0];
    expect(saved).toMatchObject({ contentType: 'image/png', extension: '.png' });
    expect(await sharp(saved.data).metadata()).toMatchObject({ format: 'png', width: 3, height: 2, hasAlpha: true });
    const rotated = await sharp(saved.data).raw().toBuffer();
    expect([...rotated.subarray(0, 4)]).toEqual([firstRed, 100, 200, 128]);
    expect(await sharp(original).raw().toBuffer()).toEqual(pixels);
    expect(storage.save).toHaveBeenCalledOnce();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(mocks.db.assemblyProcedureAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'rotated', ownerDocumentId: 'draft', kind: 'OVERLAY_IMAGE' }) });
  });

  it('normalizes EXIF orientation before rotating a JPEG referenced by another revision in the same family', async () => {
    mocks.db.assemblyProcedureAsset.findMany.mockResolvedValue([{ id: 'material', ownerDocumentId: null, storageKey: 'material.jpg', contentType: 'image/jpeg' }]);
    mocks.db.assemblyProcedureOverlayElement.findMany.mockResolvedValue([{ assetId: 'material' }]);
    const original = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#ff0000' } })
      .composite([{ input: await image('#0000ff', 20, 20), left: 20, top: 0 }])
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    storage.read.mockResolvedValue(original);

    await service().rotateOverlayImage({ documentId: 'draft', assetId: 'material', direction: 'left' });

    const [saved] = storage.save.mock.calls[0];
    expect(saved).toMatchObject({ contentType: 'image/jpeg', extension: '.jpg' });
    const output = sharp(saved.data);
    const metadata = await output.metadata();
    expect(metadata).toMatchObject({ width: 40, height: 20, format: 'jpeg' });
    expect(metadata.orientation).toBeUndefined();
    const rotated = await output.raw().toBuffer();
    expect(rotated[0]).toBeGreaterThan(240);
    expect(rotated[39 * 3 + 2]).toBeGreaterThan(240);
    expect(mocks.db.assemblyProcedureOverlayElement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ document: { revisionMetadata: { is: { revisionRootId: 'root' } } } })
    }));
  });

  it('rejects an overlay owned by another document when this revision family has no reference to it', async () => {
    mocks.db.assemblyProcedureAsset.findMany.mockResolvedValue([{ id: 'material', ownerDocumentId: 'other', storageKey: 'material.png', contentType: 'image/png' }]);
    await expect(service().rotateOverlayImage({ documentId: 'draft', assetId: 'material', direction: 'right' })).rejects.toMatchObject({ statusCode: 400 });
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rotates both copies of a sharpened image and preserves the link used to prevent sharpening twice', async () => {
    const original = { storageKey: 'original.png' };
    mocks.db.assemblyProcedureAsset.findMany.mockResolvedValue([{
      id: 'material', ownerDocumentId: 'draft', storageKey: 'material.png', contentType: 'image/png', derivedFromAsset: original
    }]);
    storage.read.mockResolvedValue(await image('red', 40, 20));
    const saved = { assetId: 'rotated', storageKey: 'rotated.png', relativeUrl: '/rotated.png', contentType: 'image/png', size: 100, sha256: 'hash' };
    storage.save
      .mockResolvedValueOnce({ ...saved, assetId: 'rotated-original', storageKey: 'rotated-original.png' })
      .mockResolvedValueOnce(saved);

    await expect(service().rotateOverlayImage({ documentId: 'draft', assetId: 'material', direction: 'right' })).resolves.toMatchObject({
      assetId: 'rotated', derivedFromAssetId: 'rotated-original', originalAsset: { assetId: 'rotated-original' }
    });
    expect(storage.read).toHaveBeenNthCalledWith(1, original);
    expect(storage.read).toHaveBeenNthCalledWith(2, expect.objectContaining({ storageKey: 'material.png' }));
    for (const [blob] of storage.save.mock.calls) {
      await expect(sharp(blob.data).metadata()).resolves.toMatchObject({ width: 20, height: 40 });
    }
    const rotated = mocks.db.assemblyProcedureAsset.create.mock.calls[1][0].data;
    expect(rotated).toMatchObject({ id: 'rotated', derivedFromAssetId: 'rotated-original', ownerDocumentId: 'draft' });
    mocks.db.assemblyProcedureAsset.findFirst.mockResolvedValue(rotated);
    await expect(service().sharpenOverlayImage({ documentId: 'draft', assetId: rotated.id })).rejects.toMatchObject({ statusCode: 409 });
    expect(storage.save).toHaveBeenCalledTimes(2);
  });
});

describe('sharpenOverlayImage', () => {
  const sharpenParams = { documentId: 'draft', accessPassword: '1234', assetId: 'photo' };
  const source = { id: 'photo', storageKey: 'photo.png', contentType: 'image/png', derivedFromAssetId: null };

  beforeEach(() => {
    mocks.db.$queryRaw.mockResolvedValue([{ id: source.id }]);
    mocks.db.assemblyProcedureAsset.findFirst.mockResolvedValue(source);
  });

  it.each(['png', 'jpeg', 'webp', 'tiff'] as const)('creates a separate %s asset at the same dimensions', async (format) => {
    const contentType = `image/${format}`;
    const photo = await sharp(await image('white', 64, 48)).composite([
      { input: await image('#404040', 24, 24), left: 20, top: 12 }
    ]).toFormat(format).toBuffer();
    const original = Buffer.from(photo);
    storage.read.mockResolvedValue(photo);
    mocks.db.assemblyProcedureAsset.findFirst.mockResolvedValue({ ...source, contentType });
    storage.save.mockResolvedValue({ assetId: 'sharpened', storageKey: `sharpened.${format}`, relativeUrl: `/sharpened.${format}`, contentType, size: 100, sha256: 'hash' });

    await expect(service().sharpenOverlayImage(sharpenParams)).resolves.toMatchObject({
      assetId: 'sharpened', contentType, kind: 'OVERLAY_IMAGE', derivedFromAssetId: source.id
    });
    const [saved] = storage.save.mock.calls[0];
    expect(saved).toMatchObject({ contentType });
    expect(saved).not.toHaveProperty('assetId');
    await expect(sharp(saved.data).metadata()).resolves.toMatchObject({ format, width: 64, height: 48 });
    expect(photo).toEqual(original);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(mocks.db.assemblyProcedureAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: 'sharpened', ownerDocumentId: 'draft', derivedFromAssetId: source.id, width: 64, height: 48
    }) });
  });

  it('rejects a source from another draft without reading its blob', async () => {
    mocks.db.assemblyProcedureAsset.findFirst.mockResolvedValue(null);
    await expect(service().sharpenOverlayImage(sharpenParams)).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.db.assemblyProcedureAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: source.id, kind: 'OVERLAY_IMAGE',
        OR: [
          { ownerDocumentId: 'draft' },
          { overlayElements: { some: { documentId: 'draft', kind: 'IMAGE' } } },
          {
            derivedAssets: {
              some: {
                OR: [
                  { ownerDocumentId: 'draft' },
                  { overlayElements: { some: { documentId: 'draft', kind: 'IMAGE' } } }
                ]
              }
            }
          }
        ]
      }
    }));
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('rejects an already sharpened source with 409', async () => {
    mocks.db.assemblyProcedureAsset.findFirst.mockResolvedValue({ ...source, derivedFromAssetId: 'original' });
    await expect(service().sharpenOverlayImage(sharpenParams)).rejects.toMatchObject({ statusCode: 409 });
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects an image larger than the overlay upload limit', async () => {
    storage.read.mockResolvedValue(Buffer.alloc(12 * 1024 * 1024 + 1));
    await expect(service().sharpenOverlayImage(sharpenParams)).rejects.toMatchObject({
      statusCode: 400, message: 'overlay画像が大きすぎます'
    });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid image before creating an asset', async () => {
    storage.read.mockResolvedValue(Buffer.from('invalid image'));
    await expect(service().sharpenOverlayImage(sharpenParams)).rejects.toMatchObject({ statusCode: 400 });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it.each(['insert', 'transaction commit'])('compensates the new blob when %s fails', async (stage) => {
    const failure = new Error('database write failed');
    if (stage === 'insert') {
      mocks.db.assemblyProcedureAsset.create.mockRejectedValue(failure);
    } else {
      mocks.db.$transaction.mockImplementation(async (work) => {
        await work(mocks.db);
        throw failure;
      });
    }
    await expect(service().sharpenOverlayImage(sharpenParams)).rejects.toBe(failure);
    expect(storage.delete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ assetId: 'crop', storageKey: 'crop.jpg' }));
  });
});

describe('assembly procedure region assets service', () => {
  it('saves a crop of the draft material instead of the blank page', async () => {
    await expect(service().createImageRegion(params)).resolves.toMatchObject({ assetId: 'crop' });
    const { data } = await sharp(storage.save.mock.calls[0][0].data).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeLessThan(15);
    expect(mocks.db.assemblyProcedureAsset.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerDocumentId: 'draft', width: 50, height: 50 }) }));
  });

  it('rewrites a full OCR line from a partial selection on top of an image overlay', async () => {
    const base = await image('#efefef', 160, 100);
    const bakedText = await sharp(base).composite([
      { input: await image('#202020', 15, 10), left: 44, top: 43 },
      { input: await image('#202020', 15, 10), left: 63, top: 43 }
    ]).png().toBuffer();
    mocks.pageImage.mockResolvedValue({ buffer: base });
    storage.read.mockResolvedValue(bakedText);
    layoutOcr.runLayoutOcrOnImage.mockResolvedValue({ text: '圧力 確認', engine: 'mock', words: [
      { text: '確認', confidence: 92, bbox: { x0: 63, y0: 43, x1: 78, y1: 53 } },
      { text: '圧力', confidence: 93, bbox: { x0: 44, y0: 43, x1: 59, y1: 53 } },
      { text: '別の行', confidence: 95, bbox: { x0: 40, y0: 73, x1: 70, y1: 84 } }
    ] });
    const result = await service().createTextRewriteRegion({
      ...params,
      bbox: { xRatio: 0.3, yRatio: 0.47, widthRatio: 0.03, heightRatio: 0.04 }
    });
    expect(result).toMatchObject({ asset: { assetId: 'crop', kind: 'OVERLAY_IMAGE' }, text: '圧力確認' });
    expect(result.textBBox.xRatio).toBeCloseTo(44 / 160);
    expect(result.textBBox.widthRatio).toBeCloseTo(34 / 160);
    expect(result.patchBBox.xRatio).toBeLessThan(result.textBBox.xRatio);
    expect(result.patchBBox.xRatio + result.patchBBox.widthRatio).toBeGreaterThan(78 / 160);
    expect(result.fontSizeRatio).toBeCloseTo(0.1);
    expect(result.color).toBe('#202020');
    const jpeg = storage.save.mock.calls[0][0].data;
    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBeCloseTo(result.patchBBox.widthRatio * 160);
    expect(info.height).toBeCloseTo(result.patchBBox.heightRatio * 100);
    expect(data.reduce((sum, value) => sum + value, 0) / data.length).toBeCloseTo(239, 0);
  });

  it('returns 422 without saving a patch when OCR has no words', async () => {
    await expect(service().createTextRewriteRegion(params)).rejects.toMatchObject({
      statusCode: 422, message: '文字が見つかりませんでした'
    });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects the oversized selection and its margins before OCR or overlay loading', async () => {
    mocks.pageImage.mockResolvedValue({ buffer: await image('white', 2020, 2000) });
    await expect(service().createTextRewriteRegion({
      ...params, bbox: { ...full, widthRatio: 0.98 }
    })).rejects.toMatchObject({ statusCode: 422, message: '範囲が広すぎます。文字の行を囲んでください' });
    expect(layoutOcr.runLayoutOcrOnImage).not.toHaveBeenCalled();
    expect(mocks.db.assemblyProcedureAsset.findMany).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('checks the actual context again after a candidate expands the selection', async () => {
    mocks.pageImage.mockResolvedValue({ buffer: await image('white', 3000, 3000) });
    mocks.db.assemblyProcedureDocument.findUnique.mockResolvedValue({ ...document, revisionMetadata: {
      ...document.revisionMetadata, sourceAsset: { kind: 'SOURCE', contentType: 'application/pdf', storageKey: 'source.pdf' }
    } });
    pdfTextCandidates.extractCandidates.mockResolvedValue([
      { text: 'wide', confidence: 1, bounds: { ...full, yRatio: 0.35, heightRatio: 0.2 }, pageIndex: 0, source: 'poppler' }
    ]);
    await expect(service().createTextRewriteRegion({
      ...params, bbox: { xRatio: 0.3, yRatio: 0.4, widthRatio: 0.1, heightRatio: 0.04 },
      overlays: [{ ...overlay, bbox: { ...roi, xRatio: 0.5 } }]
    })).rejects.toMatchObject({ statusCode: 422, message: '範囲が広すぎます。文字の行を囲んでください' });
    expect(pdfTextCandidates.extractCandidates).toHaveBeenCalledOnce();
    expect(storage.read.mock.calls).toEqual([[{ storageKey: 'source.pdf' }]]);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rewrites from the composed image instead of the PDF when an image overlaps the selection', async () => {
    mocks.db.assemblyProcedureDocument.findUnique.mockResolvedValue({ ...document, revisionMetadata: {
      ...document.revisionMetadata, sourceAsset: { kind: 'SOURCE', contentType: 'application/pdf', storageKey: 'source.pdf' }
    } });
    pdfTextCandidates.extractCandidates.mockResolvedValue([
      { text: 'original', confidence: 1, bounds: roi, pageIndex: 0, source: 'poppler' }
    ]);
    layoutOcr.runLayoutOcrOnImage.mockResolvedValue({ text: 'new', engine: 'mock', words: [
      { text: 'new', confidence: 95, bbox: { x0: 30, y0: 45, x1: 46, y1: 55 } }
    ] });
    await expect(service().createTextRewriteRegion(params)).resolves.toMatchObject({ text: 'new' });
    expect(pdfTextCandidates.extractCandidates).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalledWith({ storageKey: 'source.pdf' });
    const { data } = await sharp(layoutOcr.runLayoutOcrOnImage.mock.calls[0][0].imageBytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeLessThan(15);
  });

  it('preserves the original page crop when overlays are omitted', async () => {
    await service().createImageRegion({ ...params, overlays: undefined });
    expect(mocks.db.assemblyProcedureAsset.findMany).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    const { data } = await sharp(storage.save.mock.calls[0][0].data).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  it('returns OCR lines with page-relative bounds and normalized confidence', async () => {
    layoutOcr.runLayoutOcrOnImage.mockResolvedValue({ text: 'AB\nC', engine: 'mock', words: [
      { text: 'A', confidence: 95, bbox: { x0: 5, y0: 4, x1: 10, y1: 8 } },
      { text: 'B', confidence: 80, bbox: { x0: 11, y0: 4, x1: 15, y1: 8 } },
      { text: 'C', confidence: 120, bbox: { x0: 5, y0: 20, x1: 10, y1: 24 } }
    ] });
    const result = await service().findTextCandidates(params);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ text: 'AB', source: 'ocr', confidence: 0.8, pageIndex: 0 });
    expect(result[0].bounds?.xRatio).toBeCloseTo(0.3);
    expect(result[0].bounds?.yRatio).toBeCloseTo(0.29);
    expect(result[0].bounds?.widthRatio).toBeCloseTo(0.1);
    expect(result[0].bounds?.heightRatio).toBeCloseTo(0.04);
    expect(result[1].confidence).toBe(1);
    const input = layoutOcr.runLayoutOcrOnImage.mock.calls[0][0];
    const { data, info } = await sharp(input.imageBytes).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([50, 50]);
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeLessThan(15);
  });

  it('preserves legacy OCR candidate metadata when overlays are omitted', async () => {
    layoutOcr.runLayoutOcrOnImage.mockResolvedValue({ text: 'old', engine: 'mock', words: [
      { text: 'old', confidence: 90, bbox: { x0: 5, y0: 5, x1: 10, y1: 10 } }
    ] });
    const result = await service().findTextCandidates({ ...params, overlays: undefined });
    expect(result[0]).toMatchObject({ text: 'old', source: 'coordinate-ocr', confidence: 90 });
    expect(storage.read).not.toHaveBeenCalled();
  });

  it.each([undefined, []])('passes the unchanged crop bytes to OCR when overlays are %s', async (overlays) => {
    // A detailed image and a crop larger than 2000px expose both JPEG re-encoding and resizing.
    const pageBuffer = await sharp({ create: { width: 4200, height: 100, channels: 3, background: 'white' } })
      .composite([{ input: await image('red', 200, 100), left: 1200, top: 0 }]).png().toBuffer();
    mocks.pageImage.mockResolvedValue({ buffer: pageBuffer });
    const expected = await cropAssemblyProcedureAssetRoi(pageBuffer, roi);
    await service().findTextCandidates({ ...params, overlays });
    expect(layoutOcr.runLayoutOcrOnImage.mock.calls[0][0].imageBytes).toEqual(expected.buffer);
    expect(expected.width).toBe(2100);
  });

  it.each(['page', 'overlay'])('rejects oversized %s images with 400 for both operations', async (source) => {
    const oversized = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="6401" height="6250"><rect width="100%" height="100%" fill="red"/></svg>');
    if (source === 'page') mocks.pageImage.mockResolvedValue({ buffer: oversized });
    else storage.read.mockResolvedValue(oversized);
    await expect(service().createImageRegion(params)).rejects.toMatchObject({ statusCode: 400, message: '画像の画素数が大きすぎます' });
    await expect(service().findTextCandidates(params)).rejects.toMatchObject({ statusCode: 400, message: '画像の画素数が大きすぎます' });
    expect(storage.save).not.toHaveBeenCalled();
    expect(layoutOcr.runLayoutOcrOnImage).not.toHaveBeenCalled();
  });

  it('bounds OCR inputs to a 2000px longest edge', async () => {
    mocks.pageImage.mockResolvedValue({ buffer: await image('white', 6000, 3000) });
    await service().findTextCandidates(params);
    const metadata = await sharp(layoutOcr.runLayoutOcrOnImage.mock.calls[0][0].imageBytes).metadata();
    expect(metadata.width).toBe(2000);
    expect(metadata.height).toBe(1000);
  });

  it('prefers PDF text over OCR even with overlays', async () => {
    mocks.db.assemblyProcedureDocument.findUnique.mockResolvedValue({ ...document, revisionMetadata: {
      ...document.revisionMetadata, sourceAsset: { kind: 'SOURCE', contentType: 'application/pdf', storageKey: 'source.pdf' }
    } });
    pdfTextCandidates.extractCandidates.mockResolvedValue([{ text: 'PDF文章', confidence: 1, bounds: full, pageIndex: 0, source: 'poppler' }]);
    const result = await service().findTextCandidates(params);
    expect(result).toEqual([{ text: 'PDF文章', confidence: 1, bounds: roi, pageIndex: 0, source: 'poppler' }]);
    expect(layoutOcr.runLayoutOcrOnImage).not.toHaveBeenCalled();
    expect(storage.read).toHaveBeenCalledTimes(1);
    expect(storage.read).toHaveBeenCalledWith({ storageKey: 'source.pdf' });
  });

  it('falls back to composed image OCR when PDF text is empty', async () => {
    mocks.db.assemblyProcedureDocument.findUnique.mockResolvedValue({ ...document, revisionMetadata: {
      ...document.revisionMetadata, sourceAsset: { kind: 'SOURCE', contentType: 'application/pdf', storageKey: 'source.pdf' }
    } });
    await service().findTextCandidates(params);
    expect(pdfTextCandidates.extractCandidates).toHaveBeenCalled();
    expect(layoutOcr.runLayoutOcrOnImage).toHaveBeenCalled();
  });

  it('allows released assets referenced by a previous document in the same revision family', async () => {
    mocks.db.assemblyProcedureAsset.findMany.mockResolvedValue([{ id: 'material', ownerDocumentId: null, storageKey: 'shared.png', contentType: 'image/png' }]);
    mocks.db.assemblyProcedureOverlayElement.findMany.mockResolvedValue([{ assetId: 'material' }]);
    await service().createImageRegion(params);
    await service().findTextCandidates(params);
    expect(storage.read).toHaveBeenCalledWith({ storageKey: 'shared.png' });
    expect(mocks.db.assemblyProcedureOverlayElement.findMany).toHaveBeenCalledWith({
      where: {
        assetId: { in: ['material'] }, kind: 'IMAGE',
        document: { revisionMetadata: { is: { revisionRootId: 'root' } } }
      },
      select: { assetId: true }, distinct: ['assetId']
    });
  });

  it.each(['missing', 'other-owner', 'released-unreferenced', 'not-image'])('rejects %s assets with 400 for both operations before reading bytes', async (invalid) => {
    mocks.db.assemblyProcedureAsset.findMany.mockResolvedValue(invalid === 'missing' ? [] : [{
      id: 'material', ownerDocumentId: invalid === 'other-owner' ? 'other-draft' : invalid === 'released-unreferenced' ? null : 'draft', storageKey: 'secret', contentType: invalid === 'not-image' ? 'application/pdf' : 'image/png', derivedAssets: []
    }]);
    await expect(service().createImageRegion(params)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service().findTextCandidates(params)).rejects.toMatchObject({ statusCode: 400 });
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(layoutOcr.runLayoutOcrOnImage).not.toHaveBeenCalled();
  });

  it('ignores assets outside the ROI without reading them', async () => {
    await service().findTextCandidates({ ...params, overlays: [{ ...overlay, bbox: { xRatio: 0.8, yRatio: 0, widthRatio: 0.2, heightRatio: 0.1 } }] });
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('returns no candidates and logs a warning when OCR fails', async () => {
    layoutOcr.runLayoutOcrOnImage.mockRejectedValue(new Error('OCR unavailable'));
    await expect(service().findTextCandidates(params)).resolves.toEqual([]);
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'assembly_procedure_region_ocr_failed');
  });
});
