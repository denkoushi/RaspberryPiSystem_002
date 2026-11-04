import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env.js', () => ({ env: {} }));
vi.mock('../inference/inference-runtime.js', () => ({ getInferenceRuntime: vi.fn() }));
vi.mock('../../lib/part-measurement-drawing-storage.js', () => ({ PartMeasurementDrawingStorage: {} }));

import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';
import type { PlacementSourceItem } from './part-measurement-drawing-placement-transfer.js';
import { transferItemsSemantically } from './part-measurement-drawing-placement-semantic.js';

const item: PlacementSourceItem = {
  id: 'item', sortOrder: 1, measurementLabel: '長さ', nominalValue: 10, lowerLimit: 9.5, upperLimit: 10.8,
  depthMode: 'MEASURED', valueKind: 'NUMERIC', markerXRatio: 0.5, markerYRatio: 0.5,
  calloutTipXRatio: null, calloutTipYRatio: null
};
const dim = (overrides: Partial<PartMeasurementDrawingDimension> = {}): PartMeasurementDrawingDimension => ({
  text: '20', nominal: 20, kind: 'len', upperTolerance: null, lowerTolerance: null, depth: null,
  xRatio: 0.8, yRatio: 0.7, tileId: 'tile', ...overrides
});
const map = (dimensions = [dim()]) => ({ dimensions, image: { width: 2000, height: 1000 } });
const input = () => ({
  sourceDrawingPath: 'source', targetDrawingPath: 'target', sourceItems: [item], sourceMap: null,
  targetMap: map(), existingItems: []
});
const completeMany = vi.fn();
const readDrawing = vi.fn();
const deps = { readDrawing, vision: () => ({ completeMany }) };
const response = (items = [{ n: 1, role: '上面図 全幅', target: 'D1' as string | null }]) => ({ rawText: JSON.stringify({ items }) });

beforeEach(async () => {
  vi.resetAllMocks();
  readDrawing.mockResolvedValue({ buffer: await sharp({ create: {
    width: 200, height: 100, channels: 3, background: 'white'
  } }).png().toBuffer(), contentType: 'image/png' });
  completeMany.mockResolvedValue(response());
});

describe('transferItemsSemantically', () => {
  it('sends annotated JPEGs and semantic instructions with bounded inference settings', async () => {
    await transferItemsSemantically(input(), deps);
    expect(readDrawing.mock.calls).toEqual([['source'], ['target']]);
    const request = completeMany.mock.calls[0][0];
    expect(request).toMatchObject({ background: true, jsonOutput: true, timeoutMs: 115_000, temperature: 0, maxTokens: 6000 });
    expect(request.userText).toContain('数値の一致では選ばない');
    expect(request.userText).toContain('最初の文字から JSON');
    expect(request.userText).toContain('"nominalValue":10');
    expect(request.userText).toContain('"target":"D1","text":"20","kind":"len"');
    for (const [i, color] of ['blue', 'red'].entries()) {
      // eslint-disable-next-line no-await-in-loop
      const { data, info } = await sharp(request.images[i].imageBytes).raw().toBuffer({ resolveWithObject: true });
      expect(request.images[i]).toMatchObject({ mimeType: 'image/jpeg', label: i === 0 ? 'source' : 'target' });
      expect([info.width, info.height]).toEqual([200, 100]);
      // eslint-disable-next-line no-await-in-loop
      expect((await sharp(request.images[i].imageBytes).metadata()).format).toBe('jpeg');
      let pixels = 0;
      for (let p = 0; p < data.length; p += info.channels) {
        if (color === 'blue' ? data[p + 2] > data[p] + 70 : data[p] > data[p + 2] + 70) pixels++;
      }
      expect(pixels).toBeGreaterThan(10);
    }
  });

  it('shrinks the long edge to 1600 pixels before annotating', async () => {
    readDrawing.mockResolvedValue({ buffer: await sharp({ create: {
      width: 2000, height: 1000, channels: 3, background: 'white'
    } }).png().toBuffer() });
    await transferItemsSemantically(input(), deps);
    const image = await sharp(completeMany.mock.calls[0][0].images[0].imageBytes).metadata();
    expect([image.width, image.height]).toEqual([1600, 800]);
  });

  it('uses the target value and general tolerance, and caps the source dimension offset', async () => {
    const [result] = await transferItemsSemantically({
      ...input(), sourceMap: map([dim({ nominal: 10, xRatio: 0.47, yRatio: 0.54 })])
    }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 20, lowerLimit: 19.8, upperLimit: 20.2,
      dimension: { text: '20' }, candidates: [{ role: '上面図 全幅', target: 'D1' }] });
    expect(result.markerXRatio).toBeCloseTo(0.818);
    expect(result.markerYRatio).toBeCloseTo(0.676);
    expect(Math.hypot(result.markerXRatio! - 0.8, result.markerYRatio! - 0.7)).toBeCloseTo(0.03);
  });

  it.each([
    { nominal: 27, lowerTolerance: -0.1, upperTolerance: 0.1, lowerLimit: 26.9, upperLimit: 27.1 },
    { nominal: 27, lowerTolerance: -0.3, upperTolerance: 0.1, lowerLimit: 26.7, upperLimit: 27.1 },
    { nominal: 50, lowerTolerance: 0, upperTolerance: 0.025, lowerLimit: 50, upperLimit: 50.025 }
  ])('uses explicit target tolerances for $nominal with lower tolerance $lowerTolerance', async (test) => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceItems: [{ ...item, lowerLimit: 10, upperLimit: 10 }],
      targetMap: map([dim({ text: String(test.nominal), nominal: test.nominal,
        lowerTolerance: test.lowerTolerance, upperTolerance: test.upperTolerance })])
    }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: test.nominal,
      lowerLimit: test.lowerLimit, upperLimit: test.upperLimit });
  });

  it.each([
    { text: 'φ50 H7', nominal: 50, kind: 'len' as const, upper: 50.025 },
    { text: 'φ５０ Ｈ７', nominal: 50, kind: 'hole' as const, upper: 50.025 },
    { text: 'φ47H', nominal: 47, kind: 'hole' as const, upper: 47.025 },
    { text: 'φ47G6', nominal: 47, kind: 'hole' as const, upper: 47.025 },
    { text: 'φ47h7', nominal: 47, kind: 'hole' as const, upper: 47.025 },
    { text: 'φ47H7+0.025/0', nominal: 47, kind: 'hole' as const, upper: 47.025, lowerTolerance: 0, upperTolerance: 0.025 }
  ])('uses fit tolerances or preserves source widths for $text', async ({ upper, ...dimension }) => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceItems: [{ ...item, measurementLabel: '穴径', nominalValue: 47, lowerLimit: 47, upperLimit: 47.025 }],
      targetMap: map([dim(dimension)]) }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: dimension.nominal,
      lowerLimit: dimension.nominal, upperLimit: upper });
  });

  it('prioritizes explicit tolerances over the H7 table', async () => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceItems: [{ ...item, measurementLabel: '穴径' }],
      targetMap: map([dim({ text: 'φ47H7+0.04/-0.01', kind: 'hole', nominal: 47,
        upperTolerance: 0.04, lowerTolerance: -0.01 })]) }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 47, lowerLimit: 46.99, upperLimit: 47.04 });
  });

  it.each([
    [3, 0.010], [6, 0.012], [10, 0.015], [18, 0.018], [30, 0.021], [50, 0.025], [80, 0.030],
    [120, 0.035], [180, 0.040], [250, 0.046], [315, 0.052], [400, 0.057], [500, 0.063],
    [3.001, 0.012], [50.001, 0.030], [500.001, 0.025]
  ])('uses the inclusive H7 interval for %s', async (nominal, tolerance) => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceItems: [{ ...item, measurementLabel: '穴径', nominalValue: 47, lowerLimit: 47, upperLimit: 47.025 }],
      targetMap: map([dim({ text: `φ${nominal} H7`, nominal })]) }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', lowerLimit: nominal,
      upperLimit: Number((nominal + tolerance).toFixed(6)) });
  });

  it.each([
    { measurementLabel: 'キリ穴深さ', nominalValue: 32, lowerLimit: 31.95, upperLimit: 32, nominal: 22 },
    { measurementLabel: '深さ', nominalValue: 32.025, lowerLimit: 32, upperLimit: 32.05, nominal: 32 }
  ])('uses explicit linear depth tolerances for $measurementLabel', async ({ nominal, ...source }) => {
    const [result] = await transferItemsSemantically({ ...input(), sourceItems: [{ ...item, ...source }],
      targetMap: map([dim({ text: `${nominal} 0/-0.05`, nominal, upperTolerance: 0, lowerTolerance: -0.05 })]) }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: nominal,
      lowerLimit: nominal - 0.05, upperLimit: nominal });
  });

  it.each([
    { measurementLabel: '穴径', text: '*32±0.05', kind: 'len' as const, reason: 'hole-kind-mismatch' },
    { measurementLabel: '穴径', text: '21±0.05', kind: 'len' as const, reason: 'hole-kind-mismatch' },
    { measurementLabel: '高さ', text: 'φ32+0.025/+0.015', kind: 'hole' as const, reason: 'length-kind-mismatch' },
    { measurementLabel: 'ネジ穴ピッチ', text: '2-M4深サ8', kind: 'thread' as const, reason: 'length-kind-mismatch' },
    { measurementLabel: '平行度', text: '⊥0.005A', kind: 'gdt' as const, reason: 'geometric-symbol-mismatch' },
    { measurementLabel: '平面度', text: '⊥ 0.010 A', kind: 'gdt' as const, reason: 'geometric-symbol-mismatch' }
  ])('rejects $text for $measurementLabel', async ({ measurementLabel, reason, ...dimension }) => {
    const [result] = await transferItemsSemantically({ ...input(), sourceItems: [{ ...item, measurementLabel }],
      targetMap: map([dim(dimension)]) }, deps);
    expect(result).toMatchObject({ status: 'UNPLACED', dimension: null, candidates: [{ rejectionReason: reason }] });
  });

  it.each([
    { measurementLabel: '穴径', text: 'φ21±0.05', kind: 'hole' as const },
    { measurementLabel: '高さ', text: '32±0.05', kind: 'len' as const },
    { measurementLabel: 'ネジ穴ピッチ', text: '21±0.05', kind: 'len' as const },
    { measurementLabel: '平行度', text: '//0.005A', kind: 'gdt' as const },
    { measurementLabel: '平面度', text: '⏥ 0.010', kind: 'gdt' as const },
    { measurementLabel: '平面度', text: '0.007', kind: 'gdt' as const }
  ])('allows $text for $measurementLabel', async ({ measurementLabel, ...dimension }) => {
    const [result] = await transferItemsSemantically({ ...input(), sourceItems: [{ ...item, measurementLabel }],
      targetMap: map([dim(dimension)]) }, deps);
    expect(result.status).toBe('PROPOSED');
  });

  it.each([null, 9.5])('preserves source widths only outside the general tolerance table with lower limit %s', async (lowerLimit) => {
    const [result] = await transferItemsSemantically({ ...input(), sourceItems: [{ ...item, lowerLimit }],
      targetMap: map([dim({ text: '5000', nominal: 5000 })]) }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 5000,
      lowerLimit: lowerLimit === null ? null : 4999.5, upperLimit: 5000.8 });
  });

  it.each([0, 0.01, 0.03])('preserves source offsets of length %s within the cap', async (offset) => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceMap: map([dim({ nominal: 10, xRatio: 0.5 - offset, yRatio: 0.5 })]) }, deps);
    expect(result.markerXRatio).toBeCloseTo(0.8 + offset);
    expect(result.markerYRatio).toBeCloseTo(0.7);
  });

  it('uses default offsets and clamps to the drawing bounds', async () => {
    const [result] = await transferItemsSemantically({ ...input(), targetMap: map([dim({ xRatio: 1, yRatio: 0 })]) }, deps);
    expect([result.markerXRatio, result.markerYRatio]).toEqual([0.99, 0.01]);
  });

  it('uses the target depth as the lower limit and preserves a null upper limit', async () => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceItems: [{ ...item, measurementLabel: '穴深さ', lowerLimit: null, upperLimit: null }],
      targetMap: map([dim({ text: '深30', depth: 30 })])
    }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 30, lowerLimit: 30, upperLimit: null });
  });

  it('proposes the target hole depth from diameter text', async () => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceItems: [{ ...item, measurementLabel: '穴深さ' }],
      targetMap: map([dim({ text: 'φ10.1+0.1/0深15', kind: 'hole', nominal: 10.1, depth: 15, upperTolerance: 0.1, lowerTolerance: 0 })])
    }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 15, lowerLimit: 15, upperLimit: 15.8,
      dimension: { kind: 'hole' } });
  });

  it.each([0.1, 0.5])('sets geometric limits to zero and the new tolerance %s', async (nominal) => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceItems: [{ ...item, measurementLabel: '平面度', nominalValue: 0.2, lowerLimit: 0, upperLimit: 0.2 }],
      targetMap: map([dim({ text: `平面度${nominal}`, kind: 'gdt', nominal })])
    }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: nominal, lowerLimit: 0, upperLimit: nominal });
  });

  it('retains judgement values and limits', async () => {
    const [result] = await transferItemsSemantically({ ...input(), sourceItems: [{ ...item, valueKind: 'JUDGEMENT' }] }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 10, lowerLimit: 9.5, upperLimit: 10.8 });
  });

  it('retains a zero judgement value', async () => {
    const [result] = await transferItemsSemantically({ ...input(),
      sourceItems: [{ ...item, valueKind: 'JUDGEMENT', nominalValue: 0, lowerLimit: null, upperLimit: null }] }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 0, lowerLimit: null, upperLimit: null });
  });

  it.each([
    { text: '0H7+0.025/0', kind: 'hole' as const, nominal: 0, measurementLabel: '穴径' },
    { text: '⊥0.005', kind: 'gdt' as const, nominal: 0, measurementLabel: '直角度' },
    { text: '-1', kind: 'len' as const, nominal: -1, measurementLabel: '長さ' },
    { text: '深0', kind: 'hole' as const, nominal: 10, depth: 0, measurementLabel: '深さ' }
  ])('rejects non-positive numeric values from $text', async ({ measurementLabel, ...dimension }) => {
    const [result] = await transferItemsSemantically({ ...input(), sourceItems: [{ ...item, measurementLabel }],
      targetMap: map([dim(dimension)]) }, deps);
    expect(result).toMatchObject({ status: 'UNPLACED', dimension: null, markerXRatio: null, markerYRatio: null,
      candidates: [{ rejectionReason: 'unreadable-value' }] });
  });

  it('deduplicates existing items by the transferred value rather than the source value', async () => {
    const existing = (nominalValue: number) => [{ measurementLabel: '長さ', nominalValue }];
    expect(await transferItemsSemantically({ ...input(), existingItems: existing(20) }, deps)).toEqual([]);
    expect(await transferItemsSemantically({ ...input(), existingItems: existing(10) }, deps)).toHaveLength(1);
  });

  it('leaves null targets and unreadable values UNPLACED', async () => {
    completeMany.mockResolvedValueOnce(response([{ n: 1, role: '不明', target: null }]));
    expect(await transferItemsSemantically(input(), deps)).toMatchObject([{ status: 'UNPLACED', markerXRatio: null, dimension: null }]);
    const [result] = await transferItemsSemantically({ ...input(), sourceItems: [{ ...item, measurementLabel: '深さ' }],
      targetMap: map([dim({ text: '4-M6深', nominal: null, kind: 'thread' })]) }, deps);
    expect(result).toMatchObject({ status: 'UNPLACED', candidates: [{ rejectionReason: 'unreadable-value' }] });
  });

  it('reads a depth drawn as a linear dimension from its length', async () => {
    const [result] = await transferItemsSemantically({ ...input(), sourceItems: [{ ...item, measurementLabel: '深さ' }] }, deps);
    expect(result).toMatchObject({ status: 'PROPOSED', nominalValue: 20, lowerLimit: 20, upperLimit: 20.8 });
  });

  it('persists rejection reasons and does not place unsafe assignments', async () => {
    const [result] = await transferItemsSemantically({ ...input(), targetMap: map([dim({ kind: 'ref' })]) }, deps);
    expect(result).toMatchObject({ status: 'UNPLACED', dimension: null, markerXRatio: null,
      candidates: [{ target: 'D1', role: '上面図 全幅', rejectionReason: 'reference-dimension' }] });
  });

  it('uses source order for duplicate targets even if the response is out of order', async () => {
    completeMany.mockResolvedValue(response([{ n: 2, role: '全幅', target: 'D1' }, { n: 1, role: '全長', target: 'D1' }]));
    const results = await transferItemsSemantically({ ...input(), sourceItems: [item, { ...item, id: 'second' }] }, deps);
    expect(results.map((r) => r.status)).toEqual(['PROPOSED', 'UNPLACED']);
    expect(results[1].candidates[0].rejectionReason).toBe('duplicate-dimension');
  });

  it.each(['not JSON', '{"items":[', '{}'])('rejects broken JSON or missing items: %s', async (rawText) => {
    completeMany.mockResolvedValue({ rawText });
    await expect(transferItemsSemantically(input(), deps)).rejects.toThrow();
  });

  it.each(['D0', 'D3', 'D01', 'invalid'])('leaves invalid target %s unplaced and keeps valid items', async (target) => {
    completeMany.mockResolvedValue(response([{ n: 1, role: '', target }, { n: 2, role: '', target: 'D1' }]));
    const results = await transferItemsSemantically({ ...input(), sourceItems: [item, { ...item, id: 'second' }] }, deps);
    expect(results.map((r) => r.status)).toEqual(['UNPLACED', 'PROPOSED']);
    expect(results[0].candidates).toEqual([]);
  });

  it.each([0, -1, 3, 1.5])('ignores invalid source number %s and keeps valid items', async (n) => {
    completeMany.mockResolvedValue(response([{ n, role: '', target: 'D1' }, { n: 2, role: '', target: 'D1' }]));
    const results = await transferItemsSemantically({ ...input(), sourceItems: [item, { ...item, id: 'second' }] }, deps);
    expect(results.map((r) => r.status)).toEqual(['UNPLACED', 'PROPOSED']);
  });

  it('leaves all items unplaced for an empty items array', async () => {
    completeMany.mockResolvedValue(response([]));
    expect(await transferItemsSemantically(input(), deps)).toMatchObject([{ status: 'UNPLACED' }]);
  });

  it('accepts fenced JSON, truncates long roles, and leaves unanswered items unplaced', async () => {
    completeMany.mockResolvedValue({ rawText: '```json\n' + JSON.stringify({ items: [{ n: 1, role: '1234567890123456', target: 'D1' }] }) + '\n```' });
    const results = await transferItemsSemantically({ ...input(), sourceItems: [item, { ...item, id: 'second' }] }, deps);
    expect(results.map((r) => r.status)).toEqual(['PROPOSED', 'UNPLACED']);
    expect(results[0].candidates[0].role).toBe('123456789012345');
  });

  it('keeps the first duplicate source answer and preserves other items', async () => {
    completeMany.mockResolvedValue(response([
      { n: 1, role: 'first', target: 'D1' }, { n: 1, role: 'duplicate', target: 'D2' },
      { n: 2, role: 'second', target: 'D2' }
    ]));
    const results = await transferItemsSemantically({ ...input(), sourceItems: [item, { ...item, id: 'second' }],
      targetMap: map([dim(), dim({ text: '30', nominal: 30 })]) }, deps);
    expect(results.map((r) => r.status)).toEqual(['PROPOSED', 'PROPOSED']);
    expect(results[0].candidates[0]).toMatchObject({ role: 'first', target: 'D1' });
    expect(results[1].candidates[0]).toMatchObject({ role: 'second', target: 'D2' });
  });
});
