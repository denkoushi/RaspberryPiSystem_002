import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { planDimensionMapTiles, renderDimensionMapTiles } from './part-measurement-drawing-dimension-map-tiling.js';

describe('planDimensionMapTiles', () => {
  it('uses at least 3 columns x 2 rows with 60px overlap', () => {
    const tiles = planDimensionMapTiles(3000, 2000);
    expect(tiles.map((tile) => tile.id)).toEqual(['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1', 'r1c2']);
    expect(tiles[0]).toMatchObject({ left: 0, top: 0, width: 1060, height: 1060 });
    expect(tiles[4]).toMatchObject({ left: 940, top: 940, width: 1120, height: 1060 });
  });

  it('adds columns and rows for large drawings', () => {
    const tiles = planDimensionMapTiles(13248, 9355);
    expect(tiles).toHaveLength(5 * 3);
    const last = tiles[tiles.length - 1];
    expect(last?.box.x1).toBe(1);
    expect(last?.box.y1).toBe(1);
  });

  it('returns nothing for an empty image', () => {
    expect(planDimensionMapTiles(0, 100)).toEqual([]);
  });
});

describe('renderDimensionMapTiles', () => {
  it('produces grayscale JPEG tiles no wider than 1400px', async () => {
    const drawing = await sharp({
      create: { width: 6000, height: 1200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
    })
      .png()
      .toBuffer();
    const { image, tiles } = await renderDimensionMapTiles(drawing);
    expect(image).toEqual({ width: 6000, height: 1200 });
    expect(tiles).toHaveLength(6);
    const meta = await sharp(tiles[1]!.jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1400);
    expect(meta.channels).toBe(1);
  });
});
