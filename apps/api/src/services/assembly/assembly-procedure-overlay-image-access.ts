import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';

export async function rotateOverlayImageBytes(original: Buffer, direction: 'left' | 'right') {
  let bytes: Buffer;
  let contentType: string;
  try {
    const image = sharp(original, { limitInputPixels: 40_000_000 });
    const { format } = await image.metadata();
    const rotated = image.autoOrient().rotate(direction === 'left' ? -90 : 90).keepIccProfile();
    switch (format) {
      case 'png': bytes = await rotated.png().toBuffer(); break;
      case 'jpeg': bytes = await rotated.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer(); break;
      case 'webp': bytes = await rotated.webp({ lossless: true }).toBuffer(); break;
      case 'tiff': bytes = await rotated.tiff({ compression: 'deflate' }).toBuffer(); break;
      default: throw new ApiError(400, 'overlay画像はJPEG/PNG/WebP/TIFFのみ対応しています');
    }
    contentType = `image/${format}`;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'overlay画像を読み込めません');
  }
  return { bytes, contentType };
}

export async function readableOverlayAssets(
  documentId: string,
  revisionRootId: string,
  ids: string[],
  db: Prisma.TransactionClient
) {
  const assets = await db.assemblyProcedureAsset.findMany({
    where: { id: { in: ids }, kind: 'OVERLAY_IMAGE' },
    select: {
      id: true, ownerDocumentId: true, storageKey: true, contentType: true,
      derivedFromAsset: { select: { storageKey: true } },
      derivedAssets: {
        where: {
          kind: 'OVERLAY_IMAGE',
          OR: [
            { ownerDocumentId: documentId },
            { overlayElements: { some: { documentId, kind: 'IMAGE' } } }
          ]
        },
        select: { id: true },
        take: 1
      }
    }
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
  // An original restored in the editor can still be referenced through its sharpened copy.
  if (assets.length !== ids.length || assets.some((asset) =>
    (asset.ownerDocumentId !== documentId && !referencedIds.has(asset.id) &&
      !(asset.ownerDocumentId === null && asset.derivedAssets.length)) ||
    !asset.contentType.startsWith('image/'))) {
    throw new ApiError(400, 'overlay画像assetが存在しないか、この文書では使用できません');
  }
  return assets;
}
