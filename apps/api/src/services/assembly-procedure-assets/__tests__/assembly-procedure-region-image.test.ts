import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { composeRegionImage } from '../assembly-procedure-region-image.js';

const full = { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 };
const image = (background: string, width = 100, height = 100) => sharp({
  create: { width, height, channels: 4, background }
}).png().toBuffer();
async function pixel(buffer: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
}

describe('assembly procedure region composition', () => {
  it('projects the composed overlays in z order, including overlays extending outside the ROI', async () => {
    const result = await composeRegionImage({
      pageBuffer: await image('white'),
      roi: { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.5 },
      overlays: [
        { assetId: 'blue', bbox: { ...full, xRatio: 0.5, widthRatio: 0.5 }, zIndex: 2 },
        { assetId: 'red', bbox: full, zIndex: 1 }
      ],
      assets: new Map([['red', await image('red')], ['blue', await image('blue')]])
    });
    expect(result.width).toBe(50);
    const left = await pixel(result.buffer, 10, 25);
    const right = await pixel(result.buffer, 40, 25);
    expect(left[0]).toBeGreaterThan(240);
    expect(left[2]).toBeLessThan(15);
    expect(right[2]).toBeGreaterThan(240);
    expect(right[0]).toBeLessThan(15);
  });

  it.each(['contain', 'cover', 'fill', undefined] as const)('renders objectFit %s with transparent contain padding', async (objectFit) => {
    const result = await composeRegionImage({
      pageBuffer: await image('white'), roi: { xRatio: 0.25, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.8 },
      overlays: [{ assetId: 'red', bbox: full, zIndex: 0, objectFit }],
      assets: new Map([['red', await image('red', 100, 50)]])
    });
    const corner = await pixel(result.buffer, 10, 2);
    const center = await pixel(result.buffer, 25, 40);
    expect(center[0]).toBeGreaterThan(240);
    expect(center[1]).toBeLessThan(15);
    expect(corner[1]).toBe(objectFit === 'contain' || objectFit === undefined ? 255 : 0);
  });

  it('crops the center for cover and stretches the entire source for fill', async () => {
    const stripes = await sharp(await image('green', 120, 40)).composite([
      { input: await image('red', 40, 40), left: 0, top: 0 },
      { input: await image('blue', 40, 40), left: 80, top: 0 }
    ]).png().toBuffer();
    const assets = new Map([['stripes', stripes]]);
    const pageBuffer = await image('white', 120, 120);
    const roi = { xRatio: 0.05, yRatio: 0.25, widthRatio: 0.9, heightRatio: 0.5 };
    const cover = await composeRegionImage({ pageBuffer, roi, assets,
      overlays: [{ assetId: 'stripes', bbox: full, zIndex: 0, objectFit: 'cover' }] });
    const fill = await composeRegionImage({ pageBuffer, roi, assets,
      overlays: [{ assetId: 'stripes', bbox: full, zIndex: 0, objectFit: 'fill' }] });
    expect((await pixel(cover.buffer, 9, 30))[1]).toBeGreaterThan(100);
    expect((await pixel(cover.buffer, 99, 30))[1]).toBeGreaterThan(100);
    expect((await pixel(fill.buffer, 9, 30))[0]).toBeGreaterThan(240);
    expect((await pixel(fill.buffer, 99, 30))[2]).toBeGreaterThan(240);
  });

  it('bounds every drawing layer to the ROI even for page-sized overlays', async () => {
    const composite = vi.spyOn(sharp.prototype, 'composite');
    try {
      const result = await composeRegionImage({
        pageBuffer: await image('white', 4096, 2048),
        roi: { xRatio: 0.375, yRatio: 0.25, widthRatio: 0.03125, heightRatio: 0.03125 },
        overlays: [{ assetId: 'red', bbox: full, zIndex: 0, objectFit: 'fill' }],
        assets: new Map([['red', await image('red')]])
      });
      expect([result.width, result.height]).toEqual([128, 64]);
      const layers = composite.mock.calls[0][0];
      expect(layers).toHaveLength(1);
      for (const layer of layers) {
        expect(layer.raw!.width * layer.raw!.height).toBeLessThanOrEqual(result.width * result.height);
        expect(layer.input).toHaveLength(layer.raw!.width * layer.raw!.height * 4);
        expect(layer.left! + layer.raw!.width).toBeLessThanOrEqual(result.width);
        expect(layer.top! + layer.raw!.height).toBeLessThanOrEqual(result.height);
      }
      expect((await pixel(result.buffer, 50, 25))[0]).toBeGreaterThan(240);
    } finally {
      composite.mockRestore();
    }
  });

  it('applies opacity to existing alpha', async () => {
    const result = await composeRegionImage({
      pageBuffer: await image('white'), roi: full,
      overlays: [{ assetId: 'black', bbox: full, zIndex: 0, opacity: 0.5 }],
      assets: new Map([['black', await image('rgba(0,0,0,0.5)')]])
    });
    for (const value of await pixel(result.buffer, 50, 50)) {
      expect(value).toBeGreaterThanOrEqual(188);
      expect(value).toBeLessThanOrEqual(194);
    }
  });

  it('ignores disjoint and boundary-only overlays without reading their bytes', async () => {
    const result = await composeRegionImage({
      pageBuffer: await image('white'),
      roi: { ...full, widthRatio: 0.5 },
      overlays: [{ assetId: 'unread', bbox: { ...full, xRatio: 0.5, widthRatio: 0.5 }, zIndex: 1 }],
      assets: new Map()
    });
    expect(await pixel(result.buffer, 20, 20)).toEqual([255, 255, 255]);
  });
});
