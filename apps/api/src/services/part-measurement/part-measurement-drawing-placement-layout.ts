import {
  placementItemAlreadyExists,
  type DimensionMap,
  type PlacementDimension,
  type PlacementExistingItem,
  type PlacementSourceItem,
  type PlacementTransferResult
} from './part-measurement-drawing-placement-transfer.js';

const NEIGHBOR_DISTANCE = 0.10;
const SUPPORT_TOLERANCE = 0.025;
const SOURCE_MAX_DISTANCE = 0.25;
const MIN_SCORE = 2;
const SINGLE_CHARACTER_MIN_SCORE = 4;
const PREDICTION_NEAR_DISTANCE = 0.03;
const PREDICTION_FAR_DISTANCE = 0.08;
const MIN_ANCHORS = 6;
const RANSAC_TOLERANCE = 0.02;
const MAX_RANSAC_TRIPLES = 2000;
const SCALE_PAIR_MIN_DISTANCE = 0.05;
const VALUE_TOLERANCE = 1e-4;
// A tapped-hole note (M5深10) and a bare length (10) share a number but are different dimensions.
const HOLE_NOTE = /M\d|深/;

type Point = [number, number];
type TextPoint = { dimension: PlacementDimension; text: string; p: Point };
type Affine = [number[], number[]];
const norm = (text: string) => text.replace(/[()（）※*＊\s]/g, '');
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const heightRatio = (map: DimensionMap) => map.image.width > 0 && map.image.height > 0
  ? map.image.height / map.image.width : 1;
const points = (map: DimensionMap): TextPoint[] => map.dimensions.map(({ text, xRatio, yRatio, kind }) => ({
  dimension: { text, xRatio, yRatio, kind }, text: norm(text), p: [xRatio, yRatio * heightRatio(map)]
}));

// Keep value matching independent of layout scoring so stricter kind/value rules can replace it.
function containsValue(dimension: PlacementDimension, value: number): boolean {
  return (dimension.text.replace(/,/g, '.').match(/\d+(?:\.\d+)?/g) ?? [])
    .some((number) => Math.abs(Number(number) - value) < VALUE_TOLERANCE);
}

function unique(texts: TextPoint[]): Map<string, TextPoint> {
  const groups = new Map<string, TextPoint[]>();
  for (const text of texts) {
    if (Array.from(text.text).length < 3 || !/\d/.test(text.dimension.text)) continue;
    const group = groups.get(text.text) ?? [];
    group.push(text);
    groups.set(text.text, group);
  }
  return new Map([...groups].flatMap(([key, group]) => group.length === 1 ? [[key, group[0]]] : []));
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

// Solve the two affine least-squares systems with pivoted Gaussian elimination.
function fitAffine(anchors: { source: Point; target: Point }[]): Affine | null {
  const matrix = Array.from({ length: 3 }, () => Array<number>(5).fill(0));
  for (const { source, target } of anchors) {
    const row = [...source, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[i][j] += row[i] * row[j];
      matrix[i][3] += row[i] * target[0];
      matrix[i][4] += row[i] * target[1];
    }
  }
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let i = col + 1; i < 3; i++) {
      if (Math.abs(matrix[i][col]) > Math.abs(matrix[pivot][col])) pivot = i;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-12) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let j = col; j < 5; j++) matrix[col][j] /= divisor;
    for (let i = 0; i < 3; i++) {
      if (i === col) continue;
      const factor = matrix[i][col];
      for (let j = col; j < 5; j++) matrix[i][j] -= factor * matrix[col][j];
    }
  }
  return [matrix.map((row) => row[3]), matrix.map((row) => row[4])];
}

function predict(affine: Affine, p: Point): Point {
  return [
    affine[0][0] * p[0] + affine[0][1] * p[1] + affine[0][2],
    affine[1][0] * p[0] + affine[1][1] * p[1] + affine[1][2]
  ];
}

function estimateAffine(anchors: { source: Point; target: Point }[]): Affine | null {
  if (anchors.length < MIN_ANCHORS) return null;
  let best: typeof anchors = [];
  let tried = 0;
  triples: for (let a = 0; a < anchors.length - 2; a++) {
    for (let b = a + 1; b < anchors.length - 1; b++) {
      for (let c = b + 1; c < anchors.length; c++) {
        if (tried++ >= MAX_RANSAC_TRIPLES) break triples;
        const affine = fitAffine([anchors[a], anchors[b], anchors[c]]);
        if (!affine) continue;
        const inliers = anchors.filter(({ source, target }) => distance(predict(affine, source), target) < RANSAC_TOLERANCE);
        if (inliers.length > best.length) best = inliers;
      }
    }
  }
  return best.length >= MIN_ANCHORS ? fitAffine(best) : null;
}

export function transferItemsByLayout(input: {
  targetMap: DimensionMap;
  sourceMap: DimensionMap | null;
  sourceItems: PlacementSourceItem[];
  existingItems: PlacementExistingItem[];
}): PlacementTransferResult[] {
  const src = input.sourceMap ? points(input.sourceMap) : [];
  const tgt = points(input.targetMap);
  const us = unique(src), ut = unique(tgt);
  const anchors = [...us].flatMap(([key, source]) => {
    const target = ut.get(key);
    return target ? [{ source: source.p, target: target.p }] : [];
  });
  const ratios: number[] = [];
  for (let a = 0; a < anchors.length; a++) {
    for (let b = a + 1; b < anchors.length; b++) {
      const d = distance(anchors[a].source, anchors[b].source);
      if (d > SCALE_PAIR_MIN_DISTANCE) ratios.push(distance(anchors[a].target, anchors[b].target) / d);
    }
  }
  const scale = ratios.length >= 3 ? median(ratios) : 1;
  const affine = estimateAffine(anchors);
  const support = (sc: TextPoint, tc: TextPoint) => src.filter((text) => {
    const d = distance(text.p, sc.p);
    if (text === sc || !(d > 0 && d < NEIGHBOR_DISTANCE)) return false;
    const want: Point = [tc.p[0] + (text.p[0] - sc.p[0]) * scale, tc.p[1] + (text.p[1] - sc.p[1]) * scale];
    return tgt.some((other) => other.text === text.text && distance(other.p, want) < SUPPORT_TOLERANCE);
  }).length;

  return input.sourceItems.filter((item) => !placementItemAlreadyExists(item, input.existingItems)).map((item) => {
    const marker: Point = [item.markerXRatio, item.markerYRatio * (input.sourceMap ? heightRatio(input.sourceMap) : 1)];
    const sc = src.filter((text) => containsValue(text.dimension, item.nominalValue))
      .sort((a, b) => distance(a.p, marker) - distance(b.p, marker))[0];
    const sourceMissing = !sc || distance(sc.p, marker) > SOURCE_MAX_DISTANCE;
    const pp = sc && affine ? predict(affine, sc.p) : null;
    const candidates = tgt.filter((text) => containsValue(text.dimension, item.nominalValue) &&
      (!sc || HOLE_NOTE.test(sc.dimension.text) === HOLE_NOTE.test(text.dimension.text))).map((text) => {
      const d = distance(text.p, pp ?? sc?.p ?? marker);
      const score = sourceMissing ? 0 : support(sc, text) + (text.text === sc.text ? 2 : 0) +
        (pp ? (d < PREDICTION_NEAR_DISTANCE ? 3 : d < PREDICTION_FAR_DISTANCE ? 1 : 0) : 0);
      return { ...text.dimension, distance: d, score };
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const minimum = best && Array.from(norm(best.text)).length === 1 ? SINGLE_CHARACTER_MIN_SCORE : MIN_SCORE;
    const reason = sourceMissing ? 'source-missing' : !best ? 'no-candidate' :
      best.score < minimum || best.score === (candidates[1]?.score ?? -1) ? 'ambiguous' : null;
    const chosen = reason === null ? best : null;
    return {
      item, nominalValue: item.nominalValue, lowerLimit: item.lowerLimit, upperLimit: item.upperLimit,
      status: chosen ? 'PROPOSED' : 'UNPLACED',
      dimension: chosen ? { text: chosen.text, xRatio: chosen.xRatio, yRatio: chosen.yRatio, kind: chosen.kind } : null,
      markerXRatio: chosen ? Math.min(0.99, Math.max(0.01, chosen.xRatio)) : null,
      markerYRatio: chosen ? Math.min(0.99, Math.max(0.01, chosen.yRatio)) : null,
      candidates: reason && reason !== 'no-candidate' ? candidates.map((candidate) => ({ ...candidate, rejectionReason: reason })) : candidates
    };
  });
}
