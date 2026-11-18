import type { ImageRegionPixelRoi } from './image-region-roi.js';

type Rect = ImageRegionPixelRoi;

function seededRandom(): () => number {
  let state = 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function summedArea(
  table: Float64Array | Uint32Array, width: number, height: number,
  excluded: Uint8Array, rgb?: Uint8Array, channel = 0
): void {
  const stride = width + 1;
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!excluded[i]) row += rgb ? rgb[i * 3 + channel] : 1;
      const offset = (y + 1) * stride + x + 1;
      table[offset] = row + table[offset - stride];
    }
  }
}

function boxSum(
  table: Float64Array | Uint32Array, width: number, height: number,
  x: number, y: number, radius: number
): number {
  const stride = width + 1;
  const left = Math.max(0, x - radius);
  const right = Math.min(width, x + radius + 1);
  const top = Math.max(0, y - radius) * stride;
  const bottom = Math.min(height, y + radius + 1) * stride;
  return table[bottom + right] - table[bottom + left] - table[top + right] + table[top + left];
}

function otsu(histogram: Uint32Array, size: number): number {
  const total = histogram.reduce((sum, count, value) => sum + count * value, 0);
  let lowCount = 0;
  let lowSum = 0;
  let best = 0;
  let threshold = 22;
  for (let t = 0; t < 255; t++) {
    lowCount += histogram[t];
    lowSum += histogram[t] * t;
    const highCount = size - lowCount;
    if (!lowCount || !highCount) continue;
    const difference = lowSum / lowCount - (total - lowSum) / highCount;
    const variance = lowCount * highCount * difference ** 2;
    if (variance > best) {
      best = variance;
      threshold = t;
    }
  }
  return Math.max(22, threshold);
}

function dilateInto(
  target: Uint8Array, source: Uint8Array, width: number, height: number,
  bounds: Rect
): void {
  const radius = 5;
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  for (let y = Math.max(0, bounds.top - radius); y < Math.min(height, bottom + radius); y++) {
    const start = Math.max(0, bounds.left - radius);
    const end = Math.min(width, right + radius);
    for (let x = start; x < end; x++) {
      if (!source[y * width + x]) continue;
      const first = x;
      while (x + 1 < end && source[y * width + x + 1]) x++;
      for (let dy = -radius; dy <= radius; dy++) {
        const row = y + dy;
        if (row < bounds.top || row >= bottom) continue;
        const dx = Math.floor(Math.sqrt(radius ** 2 - dy ** 2));
        const left = Math.max(bounds.left, first - dx);
        const edge = Math.min(right, x + dx + 1);
        if (left < edge) target.fill(1, row * width + left, row * width + edge);
      }
    }
  }
}

function noiseAmplitude(rgb: Uint8Array, width: number, height: number, erase: Rect): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width; x++) {
      // Both pixels must be in the surrounding background, outside the 8px border.
      if (y >= erase.top - 8 && y < erase.top + erase.height + 8 &&
          x >= erase.left - 8 && x - 1 < erase.left + erase.width + 8) continue;
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) sum += (rgb[i + c] - rgb[i + c - 3]) ** 2;
      count += 3;
    }
  }
  return count ? Math.min(14, 0.6 * Math.sqrt(sum / count)) : 0;
}

/** Rectangles use integer pixel coordinates relative to the supplied RGB image. */
export function eraseText(input: {
  width: number;
  height: number;
  rgb: Uint8Array;
  erase: Rect;
  candidates: readonly Rect[];
  random?: () => number;
}): { rgb: Uint8Array; color: string } {
  const { width, height, rgb, erase, candidates, random = seededRandom() } = input;
  const right = erase.left + erase.width;
  const bottom = erase.top + erase.height;
  const size = width * height;
  const ex0 = new Uint8Array(size);
  let radius = 24;
  for (const box of candidates) {
    radius = Math.max(radius, Math.ceil(box.height / 2) + 14);
    const left = Math.max(0, box.left - 10);
    const edge = Math.min(width, box.left + box.width + 10);
    for (let y = Math.max(0, box.top - 12); y < Math.min(height, box.top + box.height + 12); y++) {
      if (left < edge) ex0.fill(1, y * width + left, y * width + edge);
    }
  }

  const tableSize = (width + 1) * (height + 1);
  const counts = new Uint32Array(tableSize);
  const sums = size * 255 > 0xffffffff ? new Float64Array(tableSize) : new Uint32Array(tableSize);
  const diff = new Uint8Array(size);
  summedArea(counts, width, height, ex0);
  for (let c = 0; c < 3; c++) {
    summedArea(sums, width, height, ex0, rgb, c);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const count = boxSum(counts, width, height, x, y, radius);
        if (!count) continue;
        const i = y * width + x;
        const bg = boxSum(sums, width, height, x, y, radius) / count;
        diff[i] = Math.max(diff[i], Math.round(Math.abs(rgb[i * 3 + c] - bg)));
      }
    }
  }

  const histogram = new Uint32Array(256);
  for (let y = erase.top; y < bottom; y++) {
    for (let x = erase.left; x < right; x++) histogram[diff[y * width + x]]++;
  }
  const threshold = otsu(histogram, erase.width * erase.height);
  const colorSum = [0, 0, 0];
  let colorCount = 0;
  const stroke = new Uint8Array(size);
  for (let y = erase.top; y < bottom; y++) {
    for (let x = erase.left; x < right; x++) {
      const i = y * width + x;
      if (diff[i] > threshold) {
        colorCount++;
        for (let c = 0; c < 3; c++) colorSum[c] += rgb[i * 3 + c];
        stroke[i] = 1;
      } else {
        stroke[i] = ex0[i];
      }
    }
  }
  const color = '#' + colorSum.map((sum) => Math.round(colorCount ? sum / colorCount : 0).toString(16).padStart(2, '0')).join('');
  const mask = new Uint8Array(size);
  dilateInto(mask, stroke, width, height, erase);
  for (let i = 0; i < size; i++) diff[i] = Number(diff[i] > threshold);
  const excluded = mask.slice();
  dilateInto(excluded, diff, width, height, { left: 0, top: 0, width, height });
  summedArea(counts, width, height, excluded);

  const output = new Uint8Array(rgb);
  const amplitude = noiseAmplitude(rgb, width, height, erase);
  // Only the patch needs floating-point values. Outside pixels stay fixed.
  let current = new Float32Array(erase.width * erase.height);
  let next = new Float32Array(current.length);
  for (let c = 0; c < 3; c++) {
    summedArea(sums, width, height, excluded, rgb, c);
    for (let y = erase.top; y < bottom; y++) {
      for (let x = erase.left; x < right; x++) {
        const i = y * width + x;
        let value = rgb[i * 3 + c];
        if (mask[i]) {
          const count = boxSum(counts, width, height, x, y, 22);
          // A wide stroke can exclude the entire local window.
          const remaining = counts[tableSize - 1];
          if (count) value = boxSum(sums, width, height, x, y, 22) / count;
          else if (remaining) value = sums[tableSize - 1] / remaining;
        }
        current[(y - erase.top) * erase.width + x - erase.left] = value;
      }
    }
    next.set(current);
    for (let iteration = 0; iteration < 40; iteration++) {
      for (let y = erase.top; y < bottom; y++) {
        for (let x = erase.left; x < right; x++) {
          const i = y * width + x;
          if (!mask[i]) continue;
          const j = (y - erase.top) * erase.width + x - erase.left;
          let sum = 0;
          let count = 0;
          if (x > 0) { sum += x > erase.left ? current[j - 1] : rgb[(i - 1) * 3 + c]; count++; }
          if (x + 1 < width) { sum += x + 1 < right ? current[j + 1] : rgb[(i + 1) * 3 + c]; count++; }
          if (y > 0) { sum += y > erase.top ? current[j - erase.width] : rgb[(i - width) * 3 + c]; count++; }
          if (y + 1 < height) { sum += y + 1 < bottom ? current[j + erase.width] : rgb[(i + width) * 3 + c]; count++; }
          next[j] = count ? sum / count : current[j];
        }
      }
      [current, next] = [next, current];
    }
    for (let y = erase.top; y < bottom; y++) {
      for (let x = erase.left; x < right; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        const value = current[(y - erase.top) * erase.width + x - erase.left] + (random() * 2 - 1) * amplitude;
        output[i * 3 + c] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
  }
  return { rgb: output, color };
}
