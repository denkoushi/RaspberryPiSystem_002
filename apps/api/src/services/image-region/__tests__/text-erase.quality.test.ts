import { describe, expect, it } from 'vitest';

import { eraseText } from '../text-erase.js';

type Rect = Parameters<typeof eraseText>[0]['erase'];

function pixels(width: number, rect: Rect): number[] {
  const result: number[] = [];
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) result.push(y * width + x);
  }
  return result;
}

function paint(rgb: Uint8Array, indices: readonly number[], level: number): void {
  for (const i of indices) rgb.fill(level, i * 3, i * 3 + 3);
}

function meanError(actual: Uint8Array, clean: Uint8Array, indices: readonly number[]): number {
  let error = 0;
  for (const i of indices) {
    for (let c = 0; c < 3; c++) error += Math.abs(actual[i * 3 + c] - clean[i * 3 + c]);
  }
  return error / (3 * indices.length);
}

function meanLaplacian(rgb: Uint8Array, width: number, indices: readonly number[]): number {
  const luminance = (i: number) => (rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 3;
  let sum = 0;
  for (const i of indices) {
    sum += Math.abs(4 * luminance(i) - luminance(i - 1) - luminance(i + 1) -
      luminance(i - width) - luminance(i + width));
  }
  return sum / indices.length;
}

const width = 144;
const height = 88;
const candidate = { left: 58, top: 34, width: 28, height: 19 };
const erase = { left: 51, top: 28, width: 42, height: 31 };
const strokes = [
  { left: 58, top: 34, width: 4, height: 19 },
  { left: 71, top: 34, width: 4, height: 19 },
  { left: 62, top: 40, width: 9, height: 4 },
  { left: 82, top: 34, width: 4, height: 19 }
].flatMap((rect) => pixels(width, rect));

describe('eraseText background quality', () => {
  it('reconstructs a continuous horizontal rule through the erased strokes', () => {
    const clean = new Uint8Array(width * height * 3).fill(224);
    const rule = pixels(width, { left: 0, top: 47, width, height: 1 });
    paint(clean, rule, 202);
    const rgb = clean.slice();
    paint(rgb, strokes, 24);

    const result = eraseText({ width, height, rgb, erase, candidates: [candidate] });

    const restoredRule = rule.filter((i) => i % width >= erase.left && i % width < erase.left + erase.width);
    expect(meanError(result.rgb, clean, restoredRule)).toBeLessThan(6);
    for (const i of rule) {
      expect(result.rgb[i * 3]).toBeLessThan(212);
      expect(result.rgb[(i - width) * 3]).toBeGreaterThan(212);
      expect(result.rgb[(i + width) * 3]).toBeGreaterThan(212);
    }
  });

  it('retains grain on a background with a brightness gradient', () => {
    const clean = new Uint8Array(width * height * 3);
    let seed = 12345;
    for (let i = 0; i < width * height; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = Math.floor(seed / 0x100000000 * 17) - 8;
      const level = Math.round(185 + 0.22 * (i % width) + 0.15 * Math.floor(i / width)) + grain;
      clean.fill(level, i * 3, i * 3 + 3);
    }
    const rgb = clean.slice();
    paint(rgb, strokes, 24);

    const result = eraseText({ width, height, rgb, erase, candidates: [candidate] });

    expect(meanError(result.rgb, clean, strokes)).toBeLessThan(6);
    expect(meanLaplacian(result.rgb, width, strokes)).toBeGreaterThanOrEqual(0.6 * meanLaplacian(clean, width, strokes));
  });

  it('keeps the pixels of nearby unselected lettering above and below', () => {
    const clean = new Uint8Array(width * height * 3).fill(221);
    const neighbors = [
      { left: 59, top: 22, width: 5, height: 10 },
      { left: 64, top: 25, width: 12, height: 3 },
      { left: 72, top: 55, width: 4, height: 10 },
      { left: 76, top: 61, width: 8, height: 4 }
    ].flatMap((rect) => pixels(width, rect));
    const rgb = clean.slice();
    paint(rgb, strokes, 24);
    paint(rgb, neighbors, 48);
    const before = rgb.slice();

    const result = eraseText({ width, height, rgb, erase, candidates: [candidate] });

    expect(meanError(result.rgb, clean, strokes)).toBeLessThan(6);
    expect(meanError(result.rgb, before, neighbors)).toBe(0);
    expect(rgb).toEqual(before);
  });

  it('fills from the bright surroundings when no shifted copy fits', () => {
    const width = 30;
    const height = 44;
    const clean = new Uint8Array(width * height * 3).fill(226);
    const erase = { left: 0, top: 13, width: 27, height: 18 };
    const target = { left: 0, top: 15, width: 24, height: 14 };
    const ink = pixels(width, target);
    const rgb = clean.slice();
    paint(rgb, ink, 12);
    for (const top of [7, 34]) paint(rgb, pixels(width, { left: 0, top, width, height: 3 }), 12);

    const result = eraseText({ width, height, rgb, erase, candidates: [target] });

    expect(meanError(result.rgb, clean, ink)).toBeLessThan(meanError(rgb, clean, ink));
    for (const i of pixels(width, erase)) {
      expect(result.rgb.subarray(i * 3, i * 3 + 3).some((channel) => channel >= 30)).toBe(true);
    }
  });
});
