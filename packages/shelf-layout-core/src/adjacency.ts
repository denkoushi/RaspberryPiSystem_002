import { indexToRc } from './zone-catalog.js';

export type AdjacencyValidationResult =
  | { ok: true; normalizedIndices: number[] }
  | { ok: false; reason: string };

/**
 * セル index 集合が grid 内・非空・隣接矩形であることを検証する。
 */
export function validateAdjacentRectangle(
  cellIndices: number[],
  gridSize: 3 | 4
): AdjacencyValidationResult {
  if (cellIndices.length === 0) {
    return { ok: false, reason: 'EMPTY_CELLS' };
  }
  const maxIndex = gridSize * gridSize - 1;
  const unique = [...new Set(cellIndices)].sort((a, b) => a - b);
  for (const idx of unique) {
    if (!Number.isInteger(idx) || idx < 0 || idx > maxIndex) {
      return { ok: false, reason: 'OUT_OF_BOUNDS' };
    }
  }
  const rows = unique.map((i) => indexToRc(i, gridSize).r);
  const cols = unique.map((i) => indexToRc(i, gridSize).c);
  const minR = Math.min(...rows);
  const maxR = Math.max(...rows);
  const minC = Math.min(...cols);
  const maxC = Math.max(...cols);
  const expectedCount = (maxR - minR + 1) * (maxC - minC + 1);
  if (expectedCount !== unique.length) {
    return { ok: false, reason: 'NOT_RECTANGLE' };
  }
  for (let r = minR; r <= maxR; r += 1) {
    for (let c = minC; c <= maxC; c += 1) {
      const idx = r * gridSize + c;
      if (!unique.includes(idx)) {
        return { ok: false, reason: 'NOT_RECTANGLE' };
      }
    }
  }
  return { ok: true, normalizedIndices: unique };
}

/** 2 セルが辺で隣接しているか */
export function areOrthogonallyAdjacent(a: number, b: number, gridSize: number): boolean {
  const pa = indexToRc(a, gridSize);
  const pb = indexToRc(b, gridSize);
  const dr = Math.abs(pa.r - pb.r);
  const dc = Math.abs(pa.c - pb.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}
