import sharp from 'sharp';

export type ImageRegionRoi = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type ImageRegionPixelRoi = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ImageRegionRoiImage = {
  buffer: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  pixelRoi: ImageRegionPixelRoi;
};

function assertRatio(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid image-region ROI ${name}`);
  }
}

export function normalizeImageRegionRoi(roi: ImageRegionRoi): ImageRegionRoi {
  assertRatio('xRatio', roi.xRatio);
  assertRatio('yRatio', roi.yRatio);
  assertRatio('widthRatio', roi.widthRatio);
  assertRatio('heightRatio', roi.heightRatio);
  if (roi.widthRatio <= 0 || roi.heightRatio <= 0) {
    throw new Error('Image-region ROI must have positive dimensions');
  }
  if (roi.xRatio + roi.widthRatio > 1 || roi.yRatio + roi.heightRatio > 1) {
    throw new Error('Image-region ROI is outside the source page');
  }
  return { ...roi };
}

export function imageRegionRoiToPixels(
  roi: ImageRegionRoi,
  imageWidth: number,
  imageHeight: number
): ImageRegionPixelRoi {
  const normalized = normalizeImageRegionRoi(roi);
  if (!Number.isSafeInteger(imageWidth) || imageWidth <= 0) {
    throw new Error('Invalid source page width');
  }
  if (!Number.isSafeInteger(imageHeight) || imageHeight <= 0) {
    throw new Error('Invalid source page height');
  }
  const left = Math.min(
    imageWidth - 1,
    Math.max(0, Math.floor(normalized.xRatio * imageWidth))
  );
  const top = Math.min(
    imageHeight - 1,
    Math.max(0, Math.floor(normalized.yRatio * imageHeight))
  );
  const right = Math.min(
    imageWidth,
    Math.max(left + 1, Math.ceil((normalized.xRatio + normalized.widthRatio) * imageWidth))
  );
  const bottom = Math.min(
    imageHeight,
    Math.max(top + 1, Math.ceil((normalized.yRatio + normalized.heightRatio) * imageHeight))
  );
  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

/**
 * Cuts a source-page ROI using Sharp. Coordinates remain normalized in the
 * caller's model; this function translates them only for the physical crop
 * and emits a bounded JPEG suitable for an immutable overlay asset.
 */
export async function cropImageRegionRoi(
  sourcePage: Buffer,
  roi: ImageRegionRoi,
  options: { quality?: number } = {}
): Promise<ImageRegionRoiImage> {
  if (!sourcePage.length) throw new Error('Source page image is empty');
  const source = sharp(sourcePage, { failOn: 'none' });
  const metadata = await source.metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  const pixelRoi = imageRegionRoiToPixels(roi, imageWidth, imageHeight);
  const quality = Math.min(100, Math.max(1, Math.trunc(options.quality ?? 90)));
  const rendered = await source.extract(pixelRoi).jpeg({ quality }).toBuffer({
    resolveWithObject: true
  });
  return {
    buffer: rendered.data,
    contentType: 'image/jpeg',
    width: rendered.info.width,
    height: rendered.info.height,
    pixelRoi
  };
}
