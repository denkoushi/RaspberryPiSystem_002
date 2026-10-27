import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeShelfPhoto, shelfPhotoDrawPlan, shelfPhotoRotation } from './resizeShelfPhoto';

afterEach(() => vi.restoreAllMocks());

describe('shelf photo orientation', () => {
  it.each([
    [1280, 960, true, 90, 1, 600, 800],
    [960, 1280, false, 90, 1, 800, 600],
    [960, 1280, false, 270, -1, 800, 600],
    [1280, 960, true, 270, -1, 600, 800],
    [960, 1280, false, undefined, 1, 800, 600],
    [1280, 960, false, 90, 0, 800, 600],
    [1280, 960, false, 270, 0, 800, 600],
    [960, 1280, true, 90, 0, 600, 800],
    [960, 1280, true, undefined, 0, 600, 800],
    [960, 1280, true, 270, 0, 600, 800],
    [400, 400, true, 90, 0, 400, 400],
    [300, 400, false, 90, 1, 400, 300]
  ])('plans %sx%s, portrait=%s, angle=%s', (width, height, portrait, angle, direction, outputWidth, outputHeight) => {
    expect(shelfPhotoRotation(width, height, { portrait, angle })).toBe(direction * 90);
    const plan = shelfPhotoDrawPlan(width, height, { portrait, angle });
    expect(plan.width).toBe(outputWidth);
    expect(plan.height).toBe(outputHeight);
    expect(plan.rotation).toBe(direction * Math.PI / 2);
    // All four corners must fit the output canvas after translation and rotation.
    const corners = [[0, 0], [plan.drawWidth, 0], [0, plan.drawHeight], [plan.drawWidth, plan.drawHeight]];
    const xs = corners.map(([x, y]) => plan.translateX + x * Math.cos(plan.rotation) - y * Math.sin(plan.rotation));
    const ys = corners.map(([x, y]) => plan.translateY + x * Math.sin(plan.rotation) + y * Math.cos(plan.rotation));
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(outputWidth);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(outputHeight);
  });

  it('does not rotate file images without a screen orientation', () => {
    expect(shelfPhotoRotation(960, 1280)).toBe(0);
    expect(shelfPhotoDrawPlan(960, 1280).rotation).toBe(0);
  });

  it.each([90, 270])('draws the rotated frame and releases the canvas (angle=%s)', (angle) => {
    const ctx = { drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn() };
    const canvas = {
      width: 0, height: 0, getContext: () => ctx,
      toDataURL: vi.fn(() => {
        expect([canvas.width, canvas.height]).toEqual([800, 600]);
        return 'data:image/jpeg;base64,PHOTO';
      })
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const source = {} as CanvasImageSource;
    expect(encodeShelfPhoto(source, 960, 1280, { portrait: false, angle }).dataBase64).toBe('PHOTO');
    expect(ctx.translate).toHaveBeenCalledWith(angle === 270 ? 0 : 800, angle === 270 ? 600 : 0);
    expect(ctx.rotate).toHaveBeenCalledWith(angle === 270 ? -Math.PI / 2 : Math.PI / 2);
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 600, 800);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });
});
