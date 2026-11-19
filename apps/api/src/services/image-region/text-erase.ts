import type { ImageRegionPixelRoi } from './image-region-roi.js';

type Rect = ImageRegionPixelRoi;

type EraseInput = {
  width: number;
  height: number;
  rgb: Uint8Array;
  erase: Rect;
  candidates: readonly Rect[];
  random?: () => number;
};

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const RING_WIDTH = 4;
const SEARCH_STEP = 6;
const SEARCH_TOP = 8;

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
  bounds: Rect, radius: number
): void {
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

function strokeMask({ width, height, rgb, erase, candidates }: EraseInput, output: Uint8Array) {
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
  const core = new Uint8Array(size);
  for (let y = erase.top; y < bottom; y++) {
    for (let x = erase.left; x < right; x++) {
      const i = y * width + x;
      if (diff[i] > threshold) {
        colorCount++;
        for (let c = 0; c < 3; c++) colorSum[c] += rgb[i * 3 + c];
        core[i] = 1;
      }
    }
  }
  const color = '#' + colorSum.map((sum) => Math.round(colorCount ? sum / colorCount : 0).toString(16).padStart(2, '0')).join('');
  const textHeight = candidates.reduce((max, box) => Math.max(max, box.height), 8);
  const protect = straightLines(diff, width, height, threshold, textHeight);
  const frontier: number[] = [];
  const seed = (i: number) => {
    if (core[i] !== 1 || protect[i]) return;
    core[i] = 2;
    frontier.push(i);
  };
  for (const box of candidates.length ? candidates : [erase]) {
    for (let y = Math.max(erase.top, box.top); y < Math.min(bottom, box.top + box.height); y++) {
      for (let x = Math.max(erase.left, box.left); x < Math.min(right, box.left + box.width); x++) {
        seed(y * width + x);
      }
    }
  }
  // A stroke can cross its OCR box. Keep connected ink, but protect disconnected unselected marks.
  for (let k = 0; k < frontier.length; k++) {
    const i = frontier[k];
    const x = i % width;
    const y = (i - x) / width;
    for (let yy = Math.max(erase.top, y - 1); yy < Math.min(bottom, y + 2); yy++) {
      for (let xx = Math.max(erase.left, x - 1); xx < Math.min(right, x + 2); xx++) {
        seed(yy * width + xx);
      }
    }
  }

  const mask = new Uint8Array(size);
  const other = new Uint8Array(size);
  if (!frontier.length) return { mask, other, color, busy: false };

  let boxArea = 0;
  let boxCore = 0;
  for (let y = erase.top; y < bottom; y++) {
    for (let x = erase.left; x < right; x++) {
      const i = y * width + x;
      if (ex0[i]) {
        boxArea++;
        if (core[i] === 2) boxCore++;
      }
      if (core[i] === 1) protect[i] = 1;
      core[i] = Number(core[i] === 2);
    }
  }
  const busy = boxArea > 0 && boxCore / boxArea > 0.45;
  const weak = Math.max(10, threshold * 0.35);
  if (busy) {
    for (let i = 0; i < size; i++) if (ex0[i]) core[i] = 1;
  } else {
    // Grow into anti-aliased edges and JPEG ringing up to three pixels away.
    let edge = frontier;
    for (let step = 0; step < 3; step++) {
      const next: number[] = [];
      for (const i of edge) {
        const x = i % width;
        const y = (i - x) / width;
        for (let yy = Math.max(erase.top, y - 1); yy < Math.min(bottom, y + 2); yy++) {
          for (let xx = Math.max(erase.left, x - 1); xx < Math.min(right, x + 2); xx++) {
            const j = yy * width + xx;
            if (core[j] || protect[j] || diff[j] <= weak) continue;
            core[j] = 1;
            next.push(j);
          }
        }
      }
      edge = next;
    }
  }
  dilateInto(mask, core, width, height, erase, busy ? 5 : 2);
  for (let i = 0; i < size; i++) {
    if (protect[i]) mask[i] = 0;
    core[i] = Number(diff[i] > threshold && !mask[i]);
  }
  // Keep strong marks and their immediate surroundings out of the copy sources.
  dilateInto(other, core, width, height, { left: 0, top: 0, width, height }, 3);
  if (!busy) weakLines(rgb, width, height, erase, ex0, mask, other, weak, output);
  return { mask, other, color, busy };
}

function straightLines(
  diff: Uint8Array, width: number, height: number, threshold: number, textHeight: number
): Uint8Array {
  const protect = new Uint8Array(diff.length);
  const horizontalLength = Math.max(40, Math.round(textHeight * 2));
  const verticalLength = Math.max(30, Math.round(textHeight * 1.5));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (diff[y * width + x] <= threshold) continue;
      const start = x;
      while (x + 1 < width && diff[y * width + x + 1] > threshold) x++;
      if (x - start + 1 >= horizontalLength) protect.fill(1, y * width + start, y * width + x + 1);
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (diff[y * width + x] <= threshold) continue;
      const start = y;
      while (y + 1 < height && diff[(y + 1) * width + x] > threshold) y++;
      if (y - start + 1 < verticalLength) continue;
      for (let row = start; row <= y; row++) protect[row * width + x] = 1;
    }
  }
  return protect;
}

/** Restore faint rules where the mask crosses them, using intact samples along the same line. */
function weakLines(
  rgb: Uint8Array, width: number, height: number, erase: Rect, excluded: Uint8Array,
  mask: Uint8Array, other: Uint8Array, weak: number, output: Uint8Array
): void {
  const lum = (i: number) => (rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 3;
  const minDiff = Math.max(6, weak * 0.4);
  const lineFill = new Uint8Array(mask.length);
  for (const horizontal of [true, false]) {
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    const at = (a: number, b: number) => horizontal ? a * width + b : b * width + a;
    const start = horizontal ? erase.top : erase.left;
    const end = start + (horizontal ? erase.height : erase.width);
    const isLine = new Uint8Array(outer);
    for (let a = Math.max(3, start - 2); a < Math.min(outer - 3, end + 2); a++) {
      let lighter = 0;
      let darker = 0;
      let total = 0;
      for (let b = 0; b < inner; b++) {
        const i = at(a, b);
        if (excluded[i] || mask[i] || (other[i] && !lineFill[i])) continue;
        const difference = lum(i) - (lum(at(a - 3, b)) + lum(at(a + 3, b))) / 2;
        total++;
        if (difference > minDiff) lighter++;
        else if (difference < -minDiff) darker++;
      }
      if (total >= 24 && Math.max(lighter, darker) >= total * 0.85) isLine[a] = 1;
    }
    for (let a = start; a < end; a++) {
      if (!isLine[a]) continue;
      for (let b = 0; b < inner; b++) {
        if (!mask[at(a, b)]) continue;
        let last = b;
        while (last + 1 < inner && mask[at(a, last + 1)]) last++;
        let left = b - 1;
        let right = last + 1;
        while (left >= 0 && (mask[at(a, left)] || other[at(a, left)])) left--;
        while (right < inner && (mask[at(a, right)] || other[at(a, right)])) right++;
        if (left >= 0 || right < inner) {
          for (let k = b; k <= last; k++) {
            const i = at(a, k);
            const from = left >= 0 ? at(a, left) : at(a, right);
            const to = right < inner ? at(a, right) : from;
            const weight = (k - left) / (right - left);
            for (let c = 0; c < 3; c++) {
              const first = rgb[from * 3 + c];
              output[i * 3 + c] = Math.round(first + (rgb[to * 3 + c] - first) * weight);
            }
            lineFill[i] = 1;
            mask[i] = 0;
            other[i] = 1;
          }
        }
        b = last;
      }
    }
  }
}

type Component = {
  pixels: number[];
  ring: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Label 8-connected components, then assign each ring pixel to the nearest component. */
function components(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length).fill(-1);
  const result: Component[] = [];
  const maskedPixels: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const id = result.length;
    const comp: Component = { pixels: [], ring: [], minX: width, minY: height, maxX: 0, maxY: 0 };
    result.push(comp);
    const stack = [start];
    labels[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      comp.pixels.push(i);
      const x = i % width;
      const y = (i - x) / width;
      comp.minX = Math.min(comp.minX, x);
      comp.maxX = Math.max(comp.maxX, x);
      comp.minY = Math.min(comp.minY, y);
      comp.maxY = Math.max(comp.maxY, y);
      for (let yy = Math.max(0, y - 1); yy < Math.min(height, y + 2); yy++) {
        for (let xx = Math.max(0, x - 1); xx < Math.min(width, x + 2); xx++) {
          const j = yy * width + xx;
          if (!mask[j] || labels[j] >= 0) continue;
          labels[j] = id;
          stack.push(j);
        }
      }
    }
  }

  for (let i = 0; i < mask.length; i++) if (mask[i]) maskedPixels.push(i);
  let frontier = maskedPixels;
  for (let step = 0; step < RING_WIDTH; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of NEIGHBORS) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const j = yy * width + xx;
        if (labels[j] >= 0) continue;
        labels[j] = labels[i];
        result[labels[i]].ring.push(j);
        next.push(j);
      }
    }
    frontier = next;
  }
  return { labels, components: result, maskedPixels };
}

function sample(indices: number[], cap: number): number[] {
  if (indices.length <= cap) return indices;
  return Array.from({ length: cap }, (_, i) => indices[Math.floor(i * indices.length / cap)]);
}

/** Find a shifted copy using variance of RGB differences on the surrounding ring. */
function findOffset(
  comp: Component, ring: number[], { rgb, width, height }: EraseInput, mask: Uint8Array, other: Uint8Array
): number | undefined {
  if (!ring.length) return undefined;
  const minX = RING_WIDTH - comp.minX;
  const maxX = width - 1 - RING_WIDTH - comp.maxX;
  const minY = RING_WIDTH - comp.minY;
  const maxY = height - 1 - RING_WIDTH - comp.maxY;
  if (minX > maxX || minY > maxY) return undefined;

  const blocked = (i: number) => mask[i] || other[i];
  const score = (dx: number, dy: number, pixels: number[], samples: number[]): number => {
    if (dx < minX || dx > maxX || dy < minY || dy > maxY || (!dx && !dy)) return Infinity;
    const offset = dy * width + dx;
    for (const i of pixels) if (blocked(i + offset)) return Infinity;
    let red = 0;
    let green = 0;
    let blue = 0;
    let squares = 0;
    let count = 0;
    for (const i of samples) {
      const source = i + offset;
      if (mask[source]) continue;
      const dr = rgb[i * 3] - rgb[source * 3];
      const dg = rgb[i * 3 + 1] - rgb[source * 3 + 1];
      const db = rgb[i * 3 + 2] - rgb[source * 3 + 2];
      red += dr;
      green += dg;
      blue += db;
      squares += dr * dr + dg * dg + db * db;
      count++;
    }
    if (count < samples.length * 0.5) return Infinity;
    const meanSquares = (red * red + green * green + blue * blue) / count;
    const variance = (squares - meanSquares) / count / 3;
    return variance + 0.15 * meanSquares / count / 3 +
      (1 - count / samples.length) * 50 + 0.01 * Math.hypot(dx, dy);
  };

  const radius = Math.max(comp.maxX - comp.minX + 1, comp.maxY - comp.minY + 1) + 60;
  const coarseRing = sample(ring, 200);
  const coarsePixels = sample(comp.pixels, 150);
  const scored: { cost: number; dx: number; dy: number }[] = [];
  const coarse = (dx: number, dy: number) => {
    const cost = score(dx, dy, coarsePixels, coarseRing);
    if (cost < Infinity) scored.push({ cost, dx, dy });
  };
  for (let dy = -radius; dy <= radius; dy += SEARCH_STEP) {
    for (let dx = -radius; dx <= radius; dx += SEARCH_STEP) coarse(dx, dy);
  }
  for (let d = 1; d <= radius; d++) {
    for (const [dx, dy] of NEIGHBORS) coarse(d * dx, d * dy);
  }
  scored.sort((a, b) => a.cost - b.cost);

  const fineRing = sample(ring, 1200);
  const finePixels = sample(comp.pixels, 3000);
  const halfStep = Math.ceil(SEARCH_STEP / 2);
  let bestCost = Infinity;
  let bestOffset: number | undefined;
  for (const candidate of scored.slice(0, SEARCH_TOP)) {
    for (let dy = candidate.dy - halfStep; dy <= candidate.dy + halfStep; dy++) {
      for (let dx = candidate.dx - halfStep; dx <= candidate.dx + halfStep; dx++) {
        const cost = score(dx, dy, finePixels, fineRing);
        const offset = dy * width + dx;
        if (cost >= bestCost || comp.pixels.some((i) => blocked(i + offset))) continue;
        bestCost = cost;
        bestOffset = offset;
      }
    }
  }
  return bestOffset;
}

/** Solve the membrane with fixed boundary values using Gauss–Seidel SOR. */
function solveMembrane(
  mask: Uint8Array, pixels: number[], width: number, height: number, values: Float32Array,
  boundary: (q: number, p: number) => number, iterations: number, skip: Uint8Array
): void {
  const neighbors = new Int32Array(pixels.length * 4).fill(-1);
  const fixed = new Float32Array(neighbors.length);
  for (let k = 0; k < pixels.length; k++) {
    const p = pixels[k];
    const x = p % width;
    const y = (p - x) / width;
    for (let n = 0; n < NEIGHBORS.length; n++) {
      const [dx, dy] = NEIGHBORS[n];
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const q = yy * width + xx;
      if (!mask[q] && skip[q]) continue;
      neighbors[k * 4 + n] = q;
      if (!mask[q]) fixed[k * 4 + n] = boundary(q, p);
    }
  }
  const omega = 1.85;
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let k = 0; k < pixels.length; k++) {
      let sum = 0;
      let count = 0;
      for (let n = k * 4; n < k * 4 + 4; n++) {
        const q = neighbors[n];
        if (q < 0) continue;
        sum += mask[q] ? values[q] : fixed[n];
        count++;
      }
      const p = pixels[k];
      if (count) values[p] += omega * (sum / count - values[p]);
    }
  }
}

function backgroundMean(rgb: Uint8Array, mask: Uint8Array, other: Uint8Array): number[] {
  const sums = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] || other[i]) continue;
    for (let c = 0; c < 3; c++) sums[c] += rgb[i * 3 + c];
    count++;
  }
  return count ? sums.map((sum) => sum / count) : [];
}

/** Rectangles use integer pixel coordinates relative to the supplied RGB image. */
export function eraseText(input: EraseInput): { rgb: Uint8Array; color: string } {
  const { width, height, rgb } = input;
  const out = new Uint8Array(rgb);
  const { mask, other, color, busy } = strokeMask(input, out);
  const { labels, components: regions, maskedPixels } = components(mask, width, height);
  if (!maskedPixels.length) return { rgb: out, color };

  const rings = regions.map((region) => region.ring.filter((i) => !other[i]));
  const offsets = regions.map((region, i) => findOffset(region, rings[i], input, mask, other));
  // A fully obstructed ring can still have usable background farther away.
  const background = rings.some((ring) => !ring.length) ? backgroundMean(rgb, mask, other) : [];
  for (let c = 0; c < 3; c++) {
    const values = new Float32Array(mask.length);
    const boundary = (q: number, p: number) => {
      const offset = offsets[labels[p]];
      return rgb[q * 3 + c] - (offset === undefined ? 0 : rgb[(q + offset) * 3 + c]);
    };
    for (let i = 0; i < regions.length; i++) {
      const { pixels } = regions[i];
      const offset = offsets[i];
      let sum = 0;
      let count = 0;
      for (const q of rings[i]) {
        if (offset !== undefined && mask[q + offset]) continue;
        sum += boundary(q, pixels[0]);
        count++;
      }
      const mean = count ? sum / count : background[c];
      for (const p of pixels) values[p] = mean ?? rgb[p * 3 + c];
    }
    solveMembrane(mask, maskedPixels, width, height, values, boundary, busy ? 400 : 40, other);
    for (const p of maskedPixels) {
      const offset = offsets[labels[p]];
      const value = (offset === undefined ? 0 : rgb[(p + offset) * 3 + c]) + values[p];
      out[p * 3 + c] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return { rgb: out, color };
}
