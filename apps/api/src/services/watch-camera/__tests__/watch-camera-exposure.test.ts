import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { watchCameraEnvShape } from '../../../config/env/watch-camera.js';
import { enhanceForJudgement } from '../watch-camera-exposure.js';

async function labPixels(bytes: Buffer) {
  const data = await sharp(bytes).toColourspace('lab').raw({ depth: 'float' }).toBuffer();
  return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
}

describe('watch camera exposure', () => {
  it.each([[0, 0, 0], [0, 3, 6], [6, 3, 0]])('brightens shadows without changing size or chroma (%s)', async (r, g, b) => {
    const width = 256; const height = 128;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const base = x < width / 2 ? 25 + y % 20 : 200 + y % 30;
        const i = (y * width + x) * 3;
        pixels[i] = base + r; pixels[i + 1] = base + g; pixels[i + 2] = base + b;
      }
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const original = Buffer.from(input);
    const output = await enhanceForJudgement(input);
    expect(output).not.toEqual(input);
    expect(input).toEqual(original);
    expect(await sharp(output).metadata()).toMatchObject({ width, height, format: 'jpeg' });
    const before = await labPixels(input); const after = await labPixels(output);
    // Check each half separately so opposite colour shifts cannot cancel out.
    for (const start of [0, width / 2]) {
      const sums = [0, 0, 0];
      for (let y = 0; y < height; y += 1) {
        for (let x = start; x < start + width / 2; x += 1) {
          const i = (y * width + x) * 3;
          for (let c = 0; c < 3; c += 1) sums[c] += after[i + c] - before[i + c];
        }
      }
      const means = sums.map((sum) => sum / (width * height / 2));
      if (start === 0) expect(means[0]).toBeGreaterThan(1);
      expect(Math.abs(means[1])).toBeLessThan(1);
      expect(Math.abs(means[2])).toBeLessThan(1);
    }
  });

  it.each([Buffer.from('broken jpeg'), Buffer.alloc(0)])('returns invalid input unchanged (%s)', async (bytes) => {
    expect(await enhanceForJudgement(bytes)).toBe(bytes);
  });

  it('enables enhancement by default and accepts false to disable it', () => {
    const setting = watchCameraEnvShape.WATCH_CAMERA_JUDGE_ENHANCE;
    expect(setting.parse(undefined)).toBe(true);
    expect(setting.parse('true')).toBe(true);
    expect(setting.parse('false')).toBe(false);
  });
});
