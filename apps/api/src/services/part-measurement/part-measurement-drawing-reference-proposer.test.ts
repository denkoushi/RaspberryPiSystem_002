import { describe, expect, it } from 'vitest';

import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';
import {
  buildReferenceExamples, buildReferenceMessages, describeDimensions, DrawingReferenceResponseError,
  drawingMachinePrefix, parseReferenceResponse, referenceProposalRows, selectReferenceExamples
} from './part-measurement-drawing-reference-proposer.js';

const dimension = (overrides: Partial<PartMeasurementDrawingDimension> = {}): PartMeasurementDrawingDimension => ({
  text: '64', nominal: 64, kind: 'len', depth: null, upperTolerance: null, lowerTolerance: null,
  xRatio: 0.5, yRatio: 0.5, tileId: 'tile', ...overrides
});
const map = (...dimensions: PartMeasurementDrawingDimension[]) => ({ image: { width: 100, height: 100 }, dimensions });

describe('reference prompt and examples', () => {
  it('includes all kinds and only the nearest two callouts within 0.15 for len/ref/basic', () => {
    const target = map(dimension(), dimension({ text: 'far', kind: 'hole', xRatio: 0.9 }),
      dimension({ text: 'φ8キリ', kind: 'other', xRatio: 0.6 }),
      dimension({ text: '4-M5深10', kind: 'thread', xRatio: 0.52, depth: 10 }),
      dimension({ text: 'ザグリ', kind: 'other', xRatio: 0.62 }), dimension({ text: '45°', kind: 'angle', nominal: 45 }));
    expect(describeDimensions(target)[0]).toBe('#0 len "64" nominal=64 at=(0.50,0.50) near: "4-M5深10", "φ8キリ"');
    expect(describeDimensions(target)[3]).toContain('depth=10');
    expect(describeDimensions(target)[5]).toBe('#5 angle "45°" nominal=45 at=(0.50,0.50)');
    for (const kind of ['ref', 'basic'] as const) expect(describeDimensions(map(dimension({ kind }), target.dimensions[3]))[0]).toContain('near:');
  });

  it('maps the nearest unused nominal/depth source and drops unmatched human items', () => {
    const target = map(dimension({ nominal: 5, depth: 10 }), dimension({ nominal: 10, xRatio: 0.8 }));
    const human = { label: '深さ', nominalValue: 10, markerXRatio: 0.5, markerYRatio: 0.5 };
    expect(buildReferenceExamples(target, [human, human, human, { ...human, nominalValue: 99 },
      { ...human, nominalValue: 5 }, { ...human, nominalValue: null }])).toEqual({ picks: [
      { index: 0, source: 'depth', label: '深さ' }, { index: 1, source: 'nominal', label: '深さ' },
      { index: 0, source: 'nominal', label: '深さ' }
    ] });
  });

  it('includes guide, labels, JSON examples and every target dimension', () => {
    const target = map(dimension(), dimension({ kind: 'angle' }));
    const messages = buildReferenceMessages({ processGroup: 'GRINDING', guideText: '項目名の付け方', labels: ['幅'],
      examples: [{ map: target, picks: [{ index: 1, source: 'nominal', label: '幅' }] }], target });
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(messages[0].content).toContain('項目名の付け方');
    expect(messages[0].content).toContain('GRINDING');
    expect(messages[1].content).toContain('["幅"]');
    expect(messages[1].content).toContain('{"items":[{"i":1,"use":"nominal","label":"幅"}]}');
    expect(messages[1].content.split('対象図面:\n')[1]).toBe(describeDimensions(target).join('\n'));
  });

  it('keeps picked lines beyond the first 25 and caps examples at 120 dimension lines', () => {
    const large = map(...Array.from({ length: 160 }, (_, i) => dimension({ text: `value-${i}` })));
    const content = (indices: number[]) => buildReferenceMessages({ processGroup: 'CUTTING', guideText: '', labels: ['幅'], target: map(),
      examples: [{ map: large, picks: indices.map((index) => ({ index, source: 'nominal', label: '幅' })) }] })[1].content;
    const small = content([155]);
    expect(small.match(/^#/gm)).toHaveLength(26);
    expect(small).toContain('#155');
    expect(small).not.toContain('#25 ');
    expect(content(Array.from({ length: 110 }, (_, i) => i + 30)).match(/^#/gm)).toHaveLength(120);
    const oversized = content(Array.from({ length: 160 }, (_, i) => i));
    expect(oversized.match(/^#/gm)).toHaveLength(120);
    expect(oversized).not.toContain('"i":120');
  });
});

describe('reference response', () => {
  const target = map(dimension(), dimension({ text: '// 0.005 A', kind: 'gdt', nominal: 0.005 }),
    dimension({ text: '4-M5深10', kind: 'thread', nominal: 5, depth: 10 }));
  it.each(['```json\n%s\n```', 'Here is the result:\n%s\nDone.'])('extracts JSON from %s', (wrapper) => {
    const raw = wrapper.replace('%s', '{"items":[{"i":0,"use":"nominal","label":" 幅 "}]}');
    expect(parseReferenceResponse(raw, target, ['幅'])).toEqual([{ index: 0, source: 'nominal', label: '幅' }]);
  });
  it('drops bad entries, normalizes labels, overrides deterministic names, and preserves output order', () => {
    const items = [
      { i: 99, use: 'nominal', label: '幅' }, { i: -1, use: 'nominal', label: '幅' },
      { i: 0.5, use: 'nominal', label: '幅' }, { i: 0, use: 'depth', label: '幅' },
      { i: 0, use: 'nominal', label: 'unknown' }, { i: 0, use: 'other', label: '幅' },
      { i: 2, use: 'depth', label: 'unknown' }, { i: 1, use: 'nominal', label: 'unknown' },
      { i: 0, use: 'nominal', label: ' Ａ ' }, { i: 0, use: 'nominal', label: 'A' }, null
    ];
    expect(parseReferenceResponse(JSON.stringify({ items }), target, [' A '])).toEqual([
      { index: 2, source: 'depth', label: 'ネジ穴深さ' }, { index: 1, source: 'nominal', label: '平行度' },
      { index: 0, source: 'nominal', label: 'A' }
    ]);
  });
  it.each(['garbage', '{"items":', '{}', '{"items":null}'])('throws a typed sanitized error for %s', (text) => {
    expect(() => parseReferenceResponse(text, target, [])).toThrow(DrawingReferenceResponseError);
  });
  it('computes limits, decimals, deterministic labels and output order', () => {
    const full = map(...target.dimensions, dimension({ text: 'φ47', nominal: 47, lowerTolerance: -0.10, upperTolerance: -0.05 }));
    const rows = referenceProposalRows([
      { index: 0, source: 'nominal', label: '幅' }, { index: 3, source: 'nominal', label: '穴径' },
      { index: 1, source: 'nominal', label: 'wrong' }, { index: 2, source: 'depth', label: 'wrong' }
    ], full);
    expect(rows.map(({ nominalValue, lowerLimit, upperLimit, decimalPlaces, measurementLabel }) =>
      [nominalValue, lowerLimit, upperLimit, decimalPlaces, measurementLabel])).toEqual([
      [64, 63.7, 64.3, 1, '幅'], [47, 46.9, 46.95, 2, '穴径'], [0.005, 0, 0.005, 3, '平行度'], [10, 10, 10, 0, 'ネジ穴深さ']
    ]);
    expect(rows[3]).toMatchObject({ sourceItemId: 'ref:2:depth', sortOrder: 4, depthMode: 'MEASURED', valueKind: 'NUMERIC', markerXRatio: 0.5, markerYRatio: 0.5 });
    expect(rows[3].dimension).toBe(full.dimensions[2]);
    expect(referenceProposalRows([{ index: 0, source: 'nominal', label: '幅' }], map(dimension({ nominal: 0.123456 })))[0].decimalPlaces).toBe(3);
  });
});

it('ranks examples by family, machine, dimension count, then id, excluding target fingerprints and holdouts', () => {
  const candidate = (id: string, name: string, count = 1) => ({ id, name, fingerprint: id, map: map(...Array.from({ length: count }, () => dimension())) });
  const target = candidate('target', '3351-MD001 スタンド');
  const pool = [target, { ...candidate('copy', 'スタンド'), fingerprint: 'target' }, candidate('z', '7161足'),
    candidate('family', '7161スタンド', 5), candidate('machine', '3351足', 4), candidate('a', '7161台'), candidate('far', '7161台', 10)];
  expect(selectReferenceExamples(target, pool).map(({ id }) => id)).toEqual(['family', 'machine']);
  expect(selectReferenceExamples(target, pool, { excludeMachinePrefix: '3351', excludeVisualTemplateIds: ['family'] }).map(({ id }) => id)).toEqual(['a', 'z']);
  expect(drawingMachinePrefix('３３５１-MD1')).toBe('3351');
  expect(drawingMachinePrefix('stand')).toBeNull();
});
