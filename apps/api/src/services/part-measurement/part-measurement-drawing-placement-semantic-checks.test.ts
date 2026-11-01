import { describe, expect, it } from 'vitest';

import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';
import { semanticPlacementRejections } from './part-measurement-drawing-placement-semantic-checks.js';

const assignment = (measurementLabel = '長さ', overrides: Partial<PartMeasurementDrawingDimension> = {}, target = 'D1') => ({
  measurementLabel, target, dimension: {
    text: '20', nominal: 20, kind: 'len' as const, upperTolerance: null, lowerTolerance: null,
    depth: null, xRatio: 0.5, yRatio: 0.5, tileId: 'tile', ...overrides
  }
});

describe('semanticPlacementRejections', () => {
  it.each([
    { kind: 'ref' as const }, { text: '(20)' }, { text: ' （20） ' }
  ])('rejects reference dimensions: %j', (dimension) => {
    expect(semanticPlacementRejections([assignment('幅', dimension)])).toEqual(['reference-dimension']);
  });

  it('rejects the second and later assignments to a dimension, preserving distinct dimensions', () => {
    const rows = [assignment(), assignment(), assignment(), assignment('幅', {}, 'D2')];
    expect(semanticPlacementRejections(rows)).toEqual([null, 'duplicate-dimension', 'duplicate-dimension', null]);
    expect(rows[0].dimension.text).toBe('20');
  });

  it('allows multiple geometric items on a gdt frame', () => {
    expect(semanticPlacementRejections([assignment('平面度', { kind: 'gdt' }), assignment('平行度', { kind: 'gdt' })])).toEqual([null, null]);
  });

  it.each(['平面度', '平行度', '直角度', '真円度', '円筒度', '同軸度', '同心度', '真直度', '位置度', '振れ', '全振れ', '傾斜度', '対称度', '面の輪郭度'])('requires a gdt frame for %s', (label) => {
    expect(semanticPlacementRejections([assignment(label)])).toEqual(['geometric-kind-mismatch']);
    expect(semanticPlacementRejections([assignment(label, { kind: 'gdt' })])).toEqual([null]);
  });

  it('rejects a gdt frame for a non-geometric item', () => {
    expect(semanticPlacementRejections([assignment('長さ', { kind: 'gdt' })])).toEqual(['geometric-kind-mismatch']);
  });

  it.each(['φ20', 'Φ20', '⌀20', 'ø20', 'Ø20', '4-φ20深30', '2×φ20'])('rejects diameter text for depth: %s', (text) => {
    expect(semanticPlacementRejections([assignment('穴深サ', { text, kind: 'hole', depth: null })])).toEqual(['depth-to-diameter']);
  });

  it.each(['4-φ20深30', 'φ10.1+0.1/0深15'])('allows diameter text with readable depth: %s', (text) => {
    expect(semanticPlacementRejections([assignment('穴深さ', { text, kind: 'hole', depth: 30 })])).toEqual([null]);
  });

  it('does not reserve dimensions for individually rejected items', () => {
    expect(semanticPlacementRejections([
      assignment('平面度'), assignment(), assignment(),
      assignment('深さ', { text: 'φ20', kind: 'hole' }, 'D2'),
      assignment('穴径', { text: 'φ20', kind: 'hole' }, 'D2')
    ])).toEqual(['geometric-kind-mismatch', null, 'duplicate-dimension', 'depth-to-diameter', null]);
  });

  it.each(['粗さ', '表面粗度', 'Ra', 'Rz'])('allows roughness symbols for %s items', (label) => {
    expect(semanticPlacementRejections([
      assignment(label, { text: 'Ra3.2' }), assignment(label, { text: 'Rz25' }, 'D2'),
      assignment(label, { text: '▽25' }, 'D3')
    ])).toEqual([null, null, null]);
    expect(semanticPlacementRejections([assignment(label, { text: '注記' })])).toEqual(['annotation-or-roughness']);
  });

  it.each(['Ra3.2', 'Rz25', '▽25', '注記', '基準 A'])('rejects roughness and annotation text: %s', (text) => {
    expect(semanticPlacementRejections([assignment('長さ', { text })])).toEqual(['annotation-or-roughness']);
  });

  it('rejects unreadable other dimensions, permits readable ones and ignores missing assignments', () => {
    expect(semanticPlacementRejections([
      assignment('長さ', { kind: 'other', nominal: NaN }), assignment('長さ', { kind: 'other' }, 'D2'),
      { measurementLabel: '長さ', target: null, dimension: null }
    ])).toEqual(['annotation-or-roughness', null, null]);
  });
});
