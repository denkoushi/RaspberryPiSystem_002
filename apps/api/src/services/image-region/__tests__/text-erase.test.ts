import { describe, expect, it } from 'vitest';

import { eraseText } from '../text-erase.js';

const width = 180;
const height = 100;

function background(level: number, striped = false): Uint8Array {
  return Uint8Array.from({ length: width * height * 3 }, (_, i) =>
    level + (striped && Math.floor(i / (width * 3)) % 5 === 0 ? 7 : 0));
}

function paint(rgb: Uint8Array, box: { left: number; top: number; width: number; height: number }, color: number[]) {
  for (let y = box.top; y < box.top + box.height; y++) {
    for (let x = box.left; x < box.left + box.width; x++) rgb.set(color, (y * width + x) * 3);
  }
}

function absoluteError(actual: Uint8Array, expected: Uint8Array, box: { left: number; top: number; width: number; height: number }) {
  let error = 0;
  for (let y = box.top; y < box.top + box.height; y++) {
    for (let x = box.left; x < box.left + box.width; x++) {
      for (let c = 0; c < 3; c++) {
        const i = (y * width + x) * 3 + c;
        error += Math.abs(actual[i] - expected[i]);
      }
    }
  }
  return error / (box.width * box.height * 3);
}

describe('eraseText', () => {
  it.each([
    { name: 'dark', color: [19, 25, 30], level: 208 },
    { name: 'light', color: [240, 248, 251], level: 72 },
    { name: 'yellow', color: [248, 215, 15], level: 93 }
  ])('removes $name lettering from striped backgrounds and estimates the ink color', ({ color, level }) => {
    const clean = background(level, true);
    const rgb = clean.slice();
    const candidates = [{ left: 58, top: 41, width: 45, height: 18 }];
    for (const left of [58, 74, 90]) {
      paint(rgb, { left, top: 41, width: 4, height: 18 }, color);
      paint(rgb, { left, top: 41, width: 12, height: 4 }, color);
      paint(rgb, { left, top: 49, width: 10, height: 3 }, color);
    }
    const erase = { left: 50, top: 34, width: 61, height: 32 };
    const result = eraseText({ width, height, rgb, erase, candidates });
    expect(absoluteError(result.rgb, clean, erase)).toBeLessThan(8);
    for (let c = 0; c < 3; c++) {
      const actual = parseInt(result.color.slice(1 + c * 2, 3 + c * 2), 16);
      expect(Math.abs(actual - color[c])).toBeLessThanOrEqual(30);
    }
    expect(result.rgb[0]).toBe(rgb[0]);
  });

  it('keeps neighboring unselected dark text out of the background estimate', () => {
    const clean = background(222);
    const rgb = clean.slice();
    const candidate = { left: 65, top: 40, width: 20, height: 20 };
    paint(rgb, candidate, [14, 14, 14]);
    const neighbor = { left: 98, top: 38, width: 25, height: 23 };
    paint(rgb, neighbor, [14, 14, 14]);
    const erase = { left: 59, top: 34, width: 32, height: 32 };
    const before = rgb.slice();
    const result = eraseText({ width, height, rgb, erase, candidates: [candidate], random: () => 0.5 });
    expect(absoluteError(result.rgb, clean, erase)).toBeLessThan(8);
    expect(absoluteError(result.rgb, before, neighbor)).toBe(0);
    expect(rgb).toEqual(before);
  });
});
