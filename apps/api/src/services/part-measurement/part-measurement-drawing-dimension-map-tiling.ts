import sharp from 'sharp';

import { PART_MEASUREMENT_TIFF_LIMIT_INPUT_PIXELS } from '../../lib/part-measurement-drawing-import.constants.js';

import type { PartMeasurementDrawingDimensionMapTile } from './part-measurement-drawing-dimension-map-payload.js';

const TILE_TARGET_WIDTH_PX = 3200;
const TILE_TARGET_HEIGHT_PX = 3300;
const MIN_COLUMNS = 3;
const MIN_ROWS = 2;
const TILE_OVERLAP_PX = 60;
const TILE_OUTPUT_MAX_WIDTH_PX = 1400;
const TILE_JPEG_QUALITY = 90;

export type DimensionMapTilePlan = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  box: PartMeasurementDrawingDimensionMapTile['box'];
};

/** 図面を列 max(3, ⌈W/3200⌉) × 行 max(2, ⌈H/3300⌉) に分け、各辺 60px 重ねる。 */
export function planDimensionMapTiles(imageWidth: number, imageHeight: number): DimensionMapTilePlan[] {
  if (imageWidth <= 0 || imageHeight <= 0) return [];
  const columns = Math.max(MIN_COLUMNS, Math.ceil(imageWidth / TILE_TARGET_WIDTH_PX));
  const rows = Math.max(MIN_ROWS, Math.ceil(imageHeight / TILE_TARGET_HEIGHT_PX));
  const tileWidth = Math.floor(imageWidth / columns);
  const tileHeight = Math.floor(imageHeight / rows);
  const plans: DimensionMapTilePlan[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = Math.max(0, column * tileWidth - TILE_OVERLAP_PX);
      const top = Math.max(0, row * tileHeight - TILE_OVERLAP_PX);
      const right = Math.min(imageWidth, (column + 1) * tileWidth + TILE_OVERLAP_PX);
      const bottom = Math.min(imageHeight, (row + 1) * tileHeight + TILE_OVERLAP_PX);
      plans.push({
        id: `r${row}c${column}`,
        left,
        top,
        width: right - left,
        height: bottom - top,
        box: {
          x0: left / imageWidth,
          y0: top / imageHeight,
          x1: right / imageWidth,
          y1: bottom / imageHeight
        }
      });
    }
  }
  return plans;
}

export type DimensionMapTileImage = DimensionMapTilePlan & { jpeg: Buffer };

/** 図面画像を一度だけグレースケールに展開し、タイルごとに幅 1400px 以下の JPEG を作る。 */
export async function renderDimensionMapTiles(
  drawing: Buffer
): Promise<{ image: { width: number; height: number }; tiles: DimensionMapTileImage[] }> {
  const { data, info } = await sharp(drawing, { limitInputPixels: PART_MEASUREMENT_TIFF_LIMIT_INPUT_PIXELS })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const tiles: DimensionMapTileImage[] = [];
  for (const plan of planDimensionMapTiles(info.width, info.height)) {
    // eslint-disable-next-line no-await-in-loop
    const jpeg = await sharp(data, { raw, limitInputPixels: PART_MEASUREMENT_TIFF_LIMIT_INPUT_PIXELS })
      .extract({ left: plan.left, top: plan.top, width: plan.width, height: plan.height })
      .resize({ width: TILE_OUTPUT_MAX_WIDTH_PX, withoutEnlargement: true })
      .toColourspace('b-w')
      .jpeg({ quality: TILE_JPEG_QUALITY })
      .toBuffer();
    tiles.push({ ...plan, jpeg });
  }
  return { image: { width: info.width, height: info.height }, tiles };
}
