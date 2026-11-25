import sharp, { type OverlayOptions } from 'sharp';
import { projectOverlayBBoxToCrop, type OverlayRegionImage } from '@raspi-system/shared-types';

import {
  assemblyProcedureAssetRoiToPixels,
  cropAssemblyProcedureAssetRoi,
  type AssemblyProcedureAssetPixelRoi,
  type AssemblyProcedureAssetRoi
} from './assembly-procedure-asset-roi.js';

type RegionImageInput = {
  pageBuffer: Buffer;
  roi: AssemblyProcedureAssetRoi;
  overlays: readonly OverlayRegionImage[];
  assets: ReadonlyMap<string, Buffer>;
  photoOnly?: boolean;
};

async function compositeRegion(
  input: RegionImageInput,
  pixelRoi: AssemblyProcedureAssetPixelRoi,
  width: number,
  height: number
) {
  const layers: OverlayOptions[] = [];
  for (const overlay of [...input.overlays].sort((left, right) => left.zIndex - right.zIndex)) {
    if (!projectOverlayBBoxToCrop(overlay.bbox, input.roi)) continue;
    const bytes = input.assets.get(overlay.assetId);
    if (!bytes) throw new Error('Missing region overlay asset');
    const box = assemblyProcedureAssetRoiToPixels(overlay.bbox, width, height);
    const left = Math.max(box.left, pixelRoi.left);
    const top = Math.max(box.top, pixelRoi.top);
    const intersection = {
      left: left - box.left,
      top: top - box.top,
      width: Math.min(box.left + box.width, pixelRoi.left + pixelRoi.width) - left,
      height: Math.min(box.top + box.height, pixelRoi.top + pixelRoi.height) - top
    };
    // Extract in resized coordinates before materializing: libvips evaluates only
    // the requested intersection, and the raw drawing layer cannot exceed the ROI.
    const rendered = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(box.width, box.height, {
      fit: overlay.objectFit === 'fill' ? 'fill' : overlay.objectFit === 'cover' ? 'cover' : 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }).extract(intersection).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const opacity = input.photoOnly ? 1 : overlay.opacity ?? 1;
    if (opacity < 1) {
      for (let offset = 3; offset < rendered.data.length; offset += 4) {
        rendered.data[offset] = Math.round(rendered.data[offset] * opacity);
      }
    }
    layers.push({
      input: rendered.data,
      raw: { width: rendered.info.width, height: rendered.info.height, channels: 4 },
      left: left - pixelRoi.left,
      top: top - pixelRoi.top
    });
  }
  if (!layers.length) return null;
  const pageRoi = input.photoOnly
    ? await sharp({ create: { width: pixelRoi.width, height: pixelRoi.height, channels: 3, background: '#ffffff' } }).png().toBuffer()
    : await sharp(input.pageBuffer, { limitInputPixels: 40_000_000 }).extract(pixelRoi).png().toBuffer();
  return sharp(pageRoi, { limitInputPixels: 40_000_000 }).composite(layers);
}

/** Composite only the portions of draft image overlays inside the page ROI. */
export async function composeRegionImage(input: RegionImageInput) {
  const metadata = await sharp(input.pageBuffer, { limitInputPixels: 40_000_000 }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (input.photoOnly && width * height > 40_000_000) throw new Error('Input image exceeds pixel limit');
  const pixelRoi = assemblyProcedureAssetRoiToPixels(input.roi, width, height);
  const composite = await compositeRegion(input, pixelRoi, width, height);
  if (!composite) return cropAssemblyProcedureAssetRoi(input.pageBuffer, input.roi);
  const rendered = await composite.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  return {
    buffer: rendered.data,
    contentType: 'image/jpeg' as const,
    width: rendered.info.width,
    height: rendered.info.height,
    pixelRoi
  };
}

/** Read a pixel-aligned region without a JPEG round trip. */
export async function composeRegionRgb(
  input: RegionImageInput,
  pixelRoi: AssemblyProcedureAssetPixelRoi,
  width: number,
  height: number
): Promise<Buffer> {
  const composite = await compositeRegion(input, pixelRoi, width, height);
  const source = composite ?? sharp(input.pageBuffer, { limitInputPixels: 40_000_000 }).extract(pixelRoi);
  // Flatten after compositing so transparent overlay layers blend with the page first.
  const rgb = await source.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  if (rgb.info.channels === 3) return rgb.data;
  return sharp(rgb.data, {
    raw: { width: pixelRoi.width, height: pixelRoi.height, channels: rgb.info.channels }
  }).flatten({ background: '#ffffff' }).raw().toBuffer();
}
