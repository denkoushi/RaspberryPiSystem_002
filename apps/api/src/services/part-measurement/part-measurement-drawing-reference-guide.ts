// Reference guide for business-model 丸数字 proposals. Derived on 2026-10-26 from the 30 human-marked
// inspection drawings in production (614 marked items); see docs/plans/inspection-drawing-reference-placement-execplan.md.
// Rules that the data shows are deterministic (geometric tolerance names, tapped-hole depth, limits) live in code;
// the prompt text below only covers what the model must decide: which dimensions to pick and the remaining 項目名.

import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';

export const DRAWING_REFERENCE_GUIDE_VERSION = 'reference-guide-2026-10-26';

/** Human usage counts in the 30 marked drawings, most frequent first. */
export const DRAWING_REFERENCE_LABEL_VOCABULARY: readonly { label: string; count: number }[] = [
  { label: 'ネジ穴深さ', count: 129 },
  { label: 'ネジ穴ピッチ', count: 82 },
  { label: 'キリ穴ピッチ', count: 66 },
  { label: '平行度', count: 43 },
  { label: '厚み', count: 32 },
  { label: '直角度', count: 32 },
  { label: '全幅', count: 31 },
  { label: 'ピッチ', count: 31 },
  { label: '全長', count: 26 },
  { label: 'ザグリ穴ピッチ', count: 26 },
  { label: '高さ', count: 22 },
  { label: '穴径', count: 19 },
  { label: '幅', count: 17 },
  { label: '平面度', count: 16 },
  { label: '穴ピッチ', count: 14 },
  { label: '深さ', count: 11 },
  { label: '真直度', count: 5 },
  { label: '位置度', count: 4 },
  { label: '外径', count: 3 },
  { label: '内径', count: 2 },
  { label: 'キリ穴深さ', count: 2 },
  { label: '同心度', count: 1 }
];

/** 項目名の付け方 and picking habits, written for the business model prompt. */
export const DRAWING_REFERENCE_GUIDE_TEXT = `
## 丸数字を付ける寸法の選び方（人が付けた30図面から）
- 人は図面の寸法の2〜4割だけに丸数字を付ける。全部は選ばない。
- ほぼ必ず選ぶ: ネジの深さ（「4-M5深10」の10）、公差が書かれた寸法（「27±0.1」「φ32H7+0.025/0」）、幾何公差（//、⊥、□ など）。
- よく選ぶ: 穴と穴の間隔（ピッチ）、外形の最大寸法（全幅・全長・高さ・厚み）。
- あまり選ばない: 角度、面取り、R、括弧付きの参考寸法「(20)」、基準寸法の枠付き数値、同じ値の繰り返し。
- 研削（GRINDING）は幾何公差と、公差の厳しい厚み・高さ・幅が中心。切削（CUTTING）は穴まわり（ネジ深さ・ピッチ・穴径）と外形が中心。

## 項目名の付け方
- 穴の間隔は、その寸法のそばにある穴の呼びで決める。
  - M ネジ（「M6深12」など）の間隔 → ネジ穴ピッチ
  - キリ穴やザグリ付きボルト穴（「φ11キリ」「φ17.5ザグリ深10」）の間隔 → キリ穴ピッチ（ザグリ部分そのものの間隔ならザグリ穴ピッチ）
  - 穴の種類が分からない穴の間隔 → 穴ピッチ
  - 穴ではない繰り返し形状の間隔、PCD → ピッチ
- 外形: 部品の長手方向の最大寸法 → 全長、横方向の最大寸法 → 全幅、板や台の厚さ → 厚み、縦方向の寸法 → 高さ、部分的な幅や溝幅 → 幅、溝や段の深さ → 深さ。
- 穴の直径（φ付きの穴寸法） → 穴径。はめあい穴の内側を測るときは内径、軸や外側の円は外径。
- ネジの深さ → ネジ穴深さ。キリ穴の深さ → キリ穴深さ。
- 項目名は下の一覧から選ぶ。一覧にない名前を作らない。
`.trim();

/** Geometric tolerance symbol → 項目名. Order matters: the first match wins. */
const GDT_LABELS: readonly [RegExp, string][] = [
  [/\/\/|∥/, '平行度'],
  [/⊥/, '直角度'],
  [/⏥|▱|□/, '平面度'],
  [/⌖/, '位置度'],
  [/◎/, '同心度'],
  [/—|─|━|^-\s*0/, '真直度'],
  [/^\s*φ\s*0?\.\d/, '位置度']
];

export function geometricToleranceLabel(text: string): string | null {
  const normalized = text.normalize('NFKC');
  for (const [pattern, label] of GDT_LABELS) if (pattern.test(normalized) || pattern.test(text)) return label;
  return null;
}

/** JIS B 0405 general tolerance, class m (中級). Matches 246 of 274 untoleranced human length items. */
export function generalTolerance(nominal: number): number {
  const size = Math.abs(nominal);
  if (size <= 6) return 0.1;
  if (size <= 30) return 0.2;
  if (size <= 120) return 0.3;
  if (size <= 400) return 0.5;
  if (size <= 1000) return 0.8;
  if (size <= 2000) return 1.2;
  return 2;
}

export type DrawingReferenceValueSource = 'nominal' | 'depth';

/** Deterministic limits for a picked dimension. Human data: thread depth 75 of 121 use depth..depth. */
export function referenceLimits(dimension: PartMeasurementDrawingDimension, source: DrawingReferenceValueSource): {
  nominalValue: number; lowerLimit: number; upperLimit: number;
} {
  if (source === 'depth' && dimension.depth !== null) {
    return { nominalValue: dimension.depth, lowerLimit: dimension.depth, upperLimit: dimension.depth };
  }
  const nominalValue = dimension.nominal;
  if (dimension.kind === 'gdt') return { nominalValue, lowerLimit: 0, upperLimit: nominalValue };
  if (dimension.upperTolerance !== null || dimension.lowerTolerance !== null) {
    return {
      nominalValue,
      lowerLimit: nominalValue + (dimension.lowerTolerance ?? 0),
      upperLimit: nominalValue + (dimension.upperTolerance ?? 0)
    };
  }
  const tolerance = generalTolerance(nominalValue);
  return { nominalValue, lowerLimit: nominalValue - tolerance, upperLimit: nominalValue + tolerance };
}

/** Label fixed by code for a pick, or null when the model's label is used. */
export function deterministicReferenceLabel(
  dimension: PartMeasurementDrawingDimension, source: DrawingReferenceValueSource
): string | null {
  if (dimension.kind === 'gdt') return geometricToleranceLabel(dimension.text);
  if (source === 'depth' && (dimension.kind === 'thread' || /M\d/.test(dimension.text.normalize('NFKC')))) return 'ネジ穴深さ';
  return null;
}
