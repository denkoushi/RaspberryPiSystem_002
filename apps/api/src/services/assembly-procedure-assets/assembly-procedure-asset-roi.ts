import {
  cropImageRegionRoi,
  imageRegionRoiToPixels,
  normalizeImageRegionRoi
} from '../image-region/image-region-roi.js';

import type {
  ImageRegionPixelRoi,
  ImageRegionRoi,
  ImageRegionRoiImage
} from '../image-region/image-region-roi.js';

/** @deprecated Use ImageRegionRoi from the domain-neutral image-region module. */
export type AssemblyProcedureAssetRoi = ImageRegionRoi;

/** @deprecated Use ImageRegionPixelRoi from the domain-neutral image-region module. */
export type AssemblyProcedureAssetPixelRoi = ImageRegionPixelRoi;

/** @deprecated Use ImageRegionRoiImage from the domain-neutral image-region module. */
export type AssemblyProcedureAssetRoiImage = ImageRegionRoiImage;

function rethrowAssemblyRoiError(error: unknown): never {
  if (error instanceof Error) {
    const message = error.message
      .replace('Invalid image-region ROI ', 'Invalid assembly procedure ROI ')
      .replace(
        'Image-region ROI must have positive dimensions',
        'Assembly procedure ROI must have positive dimensions'
      )
      .replace(
        'Image-region ROI is outside the source page',
        'Assembly procedure ROI is outside the source page'
      );
    throw new Error(message);
  }
  throw error;
}

/** @deprecated Use normalizeImageRegionRoi. */
export function normalizeAssemblyProcedureAssetRoi(
  roi: AssemblyProcedureAssetRoi
): AssemblyProcedureAssetRoi {
  try {
    return normalizeImageRegionRoi(roi);
  } catch (error) {
    return rethrowAssemblyRoiError(error);
  }
}

/** @deprecated Use imageRegionRoiToPixels. */
export function assemblyProcedureAssetRoiToPixels(
  roi: AssemblyProcedureAssetRoi,
  imageWidth: number,
  imageHeight: number
): AssemblyProcedureAssetPixelRoi {
  try {
    return imageRegionRoiToPixels(roi, imageWidth, imageHeight);
  } catch (error) {
    return rethrowAssemblyRoiError(error);
  }
}

/** @deprecated Use cropImageRegionRoi. */
export async function cropAssemblyProcedureAssetRoi(
  sourcePage: Buffer,
  roi: AssemblyProcedureAssetRoi,
  options: { quality?: number } = {}
): Promise<AssemblyProcedureAssetRoiImage> {
  try {
    return await cropImageRegionRoi(sourcePage, roi, options);
  } catch (error) {
    return rethrowAssemblyRoiError(error);
  }
}
