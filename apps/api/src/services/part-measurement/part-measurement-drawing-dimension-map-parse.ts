import {
  PART_MEASUREMENT_DRAWING_DIMENSION_KINDS,
  type PartMeasurementDrawingDimension,
  type PartMeasurementDrawingDimensionKind,
  type PartMeasurementDrawingDimensionMapTile
} from './part-measurement-drawing-dimension-map-payload.js';

/** タイル内の座標系（左上 0,0 / 右下 1000,1000）。 */
const TILE_COORDINATE_SCALE = 1000;
/** 同じ値で、この距離（図面幅に対する比）より近いものは同じ寸法とみなす。 */
const DUPLICATE_DISTANCE_RATIO = 0.01;

const ROW_KEYS = ['表記', '基準値', '上の許容差', '下の許容差', '種類', '深さ', 'x', 'y'] as const;

export function buildDimensionMapTilePrompt(tileCount: number): string {
  return `これは機械部品図面を ${tileCount} 分割したうちの 1 枚です。図面に書かれている寸法と幾何公差を、漏れなくすべて挙げてください。

各寸法を次の配列 1 行で表し、全体を {"dimensions": [配列, 配列, ...]} の JSON オブジェクトで出力してください（説明文は不要）。
[表記, 基準値, 上の許容差, 下の許容差, 種類, 深さ, x, y]
- 表記: 図面のとおりの文字（例 "φ10.1+0.1/0深15"、"4-M5深10"、"(25)"、"540±0.3"）
- 基準値: 数値。ねじは呼び径（M5 なら 5）、穴は直径、幾何公差は公差値
- 上の許容差・下の許容差: 図面に書かれていれば数値（±0.3 なら 0.3 と -0.3、+0.1/0 なら 0.1 と 0）、無ければ null
- 種類: "len"（長さ）, "ref"（括弧付きの参考寸法）, "basic"（枠で囲んだ理論寸法）, "angle", "radius", "hole"（穴径、キリ、ザグリ）, "thread"（ねじ）, "gdt"（幾何公差の枠）
- 深さ: 「深15」のような深さがあれば数値、無ければ null
- x, y: その寸法の文字の中心の位置（この画像の左上を 0,0、右下を 1000,1000 とした整数）
注記の文章、表題欄、表（普通公差表など）の数字は含めないでください。分割の端で文字が切れている寸法は含めないでください。`;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function toKind(value: unknown): PartMeasurementDrawingDimensionKind {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (PART_MEASUREMENT_DRAWING_DIMENSION_KINDS as readonly string[]).includes(kind)
    ? (kind as PartMeasurementDrawingDimensionKind)
    : 'other';
}

function extractRowList(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.dimensions)) return record.dimensions;
    const firstArray = Object.values(record).find((value) => Array.isArray(value));
    return Array.isArray(firstArray) ? firstArray : null;
  }
  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * VLM の応答から寸法行を取り出す。行は配列 `[表記, 基準値, …, x, y]` と、
 * 同じ日本語キーを持つオブジェクトの両方を受け付ける。JSON として読めないときは null。
 */
export function parseDimensionMapTileResponse(rawText: string): unknown[][] | null {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '');
  let rows = extractRowList(tryParseJson(stripped));
  if (!rows) {
    const arrayMatch = stripped.match(/\[[\s\S]*\]/u);
    rows = arrayMatch ? extractRowList(tryParseJson(arrayMatch[0])) : null;
  }
  if (!rows) return null;
  return rows
    .map((row) => {
      if (Array.isArray(row)) return row;
      if (row && typeof row === 'object') {
        const record = row as Record<string, unknown>;
        return ROW_KEYS.map((key) => record[key]);
      }
      return null;
    })
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= ROW_KEYS.length);
}

function isExcludedNotation(text: string): boolean {
  return /^\s*Ra/u.test(text) || /\d\s*C$/u.test(text);
}

function clampTileCoordinate(value: number): number {
  return Math.min(TILE_COORDINATE_SCALE, Math.max(0, value));
}

/** タイル内の寸法行を図面全体の座標に直す。表面粗さ（Ra）と面取り（0.5C 等）は除く。 */
export function toDrawingDimensions(
  rows: unknown[][],
  tile: Pick<PartMeasurementDrawingDimensionMapTile, 'id' | 'box'>
): PartMeasurementDrawingDimension[] {
  const { x0, y0, x1, y1 } = tile.box;
  const dimensions: PartMeasurementDrawingDimension[] = [];
  for (const row of rows) {
    const [rawText, rawNominal, rawUpper, rawLower, rawKind, rawDepth, rawX, rawY] = row;
    const text = rawText == null ? '' : String(rawText);
    const nominal = toNumber(rawNominal);
    const x = toNumber(rawX);
    const y = toNumber(rawY);
    if (nominal === null || x === null || y === null || isExcludedNotation(text)) continue;
    dimensions.push({
      text,
      nominal,
      upperTolerance: toNumber(rawUpper),
      lowerTolerance: toNumber(rawLower),
      kind: toKind(rawKind),
      depth: toNumber(rawDepth),
      xRatio: x0 + (clampTileCoordinate(x) / TILE_COORDINATE_SCALE) * (x1 - x0),
      yRatio: y0 + (clampTileCoordinate(y) / TILE_COORDINATE_SCALE) * (y1 - y0),
      tileId: tile.id
    });
  }
  return dimensions;
}

/** タイルの重なりで二重に読んだ寸法（同じ基準値で、図面幅の 1% 以内）を先に出た方へまとめる。 */
export function mergeDuplicateDimensions(
  dimensions: PartMeasurementDrawingDimension[],
  image: { width: number; height: number }
): PartMeasurementDrawingDimension[] {
  const heightPerWidth = image.width > 0 ? image.height / image.width : 1;
  const merged: PartMeasurementDrawingDimension[] = [];
  for (const dimension of dimensions) {
    const duplicate = merged.some(
      (kept) =>
        Math.abs(kept.nominal - dimension.nominal) < 1e-6 &&
        Math.hypot(kept.xRatio - dimension.xRatio, (kept.yRatio - dimension.yRatio) * heightPerWidth) <
          DUPLICATE_DISTANCE_RATIO
    );
    if (!duplicate) merged.push(dimension);
  }
  return merged;
}
