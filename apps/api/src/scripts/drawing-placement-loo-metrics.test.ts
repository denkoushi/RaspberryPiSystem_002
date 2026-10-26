import { describe, expect, it } from 'vitest';

import { comparePlacementMarkers, nominalMatched, placementRates, type EvaluationMarker } from './drawing-placement-loo-metrics.js';

const marker = (overrides: Partial<EvaluationMarker> = {}): EvaluationMarker => ({
  nominalValue: 10, measurementLabel: '径', markerXRatio: 0.5, markerYRatio: 0.5, ...overrides
});

describe('leave-one-out placement metrics', () => {
  it('matches exact markers and normalized labels', () => {
    expect(comparePlacementMarkers([marker({ measurementLabel: ' Ａ ' })], [marker({ measurementLabel: 'A' })])).toEqual({
      humanCount: 1, proposalCount: 1, matched: 1, positionOk: 1, precision: 1, recall: 1, positionOkRate: 1
    });
  });

  it('rejects different nonempty labels and nominal values outside epsilon', () => {
    expect(comparePlacementMarkers([marker({ measurementLabel: '長さ' }), marker({ nominalValue: 10.000002 })], [marker()]))
      .toMatchObject({ matched: 0, precision: 0, recall: 0 });
  });

  it('accepts a missing label and nominal difference within epsilon', () => {
    expect(comparePlacementMarkers([marker({ measurementLabel: '', nominalValue: 10.0000005 })], [marker()]))
      .toMatchObject({ matched: 1, positionOk: 1 });
  });

  it('counts a matched item outside the Euclidean position tolerance', () => {
    expect(comparePlacementMarkers([marker({ markerXRatio: 0.525, markerYRatio: 0.525 })], [marker()]))
      .toMatchObject({ matched: 1, positionOk: 0, precision: 1, recall: 1, positionOkRate: 0 });
  });

  it('matches each item once, globally nearest first, despite proposal order', () => {
    expect(comparePlacementMarkers([marker({ markerXRatio: 0.52 }), marker()], [marker()], 0.01))
      .toMatchObject({ humanCount: 1, proposalCount: 2, matched: 1, positionOk: 1, precision: 0.5 });
    expect(comparePlacementMarkers([marker()], [marker({ markerXRatio: 0.52 }), marker()], 0.01))
      .toMatchObject({ matched: 1, positionOk: 1, recall: 0.5, positionOkRate: 0.5 });
  });

  it('includes marked humans without nominal values in the denominator', () => {
    expect(comparePlacementMarkers([marker()], [marker(), marker({ nominalValue: null })]))
      .toMatchObject({ humanCount: 2, matched: 1, recall: 0.5 });
  });

  it('uses inclusive tolerance and defines empty denominators as zero', () => {
    expect(comparePlacementMarkers([marker({ markerXRatio: 0 })], [marker({ markerXRatio: 0.03 })], 0.03).positionOk).toBe(1);
    expect(comparePlacementMarkers([], [])).toEqual({
      humanCount: 0, proposalCount: 0, matched: 0, positionOk: 0, precision: 0, recall: 0, positionOkRate: 0
    });
  });

  it('computes micro averages from summed counts', () => {
    const rows = [comparePlacementMarkers([marker()], [marker()]), comparePlacementMarkers([], [marker(), marker()])];
    expect(placementRates({
      humanCount: rows.reduce((sum, row) => sum + row.humanCount, 0),
      proposalCount: rows.reduce((sum, row) => sum + row.proposalCount, 0),
      matched: rows.reduce((sum, row) => sum + row.matched, 0),
      positionOk: rows.reduce((sum, row) => sum + row.positionOk, 0)
    })).toMatchObject({ precision: 1, recall: 1 / 3, positionOkRate: 1 / 3 });
  });
});

it('counts nominal-only matches one-to-one, ignoring labels and preserving null exclusion', () => {
  const marker = (nominalValue: number | null, measurementLabel: string) => ({ nominalValue, measurementLabel, markerXRatio: 0, markerYRatio: 0 });
  expect(nominalMatched([marker(10, '幅'), marker(10, '全幅'), marker(null, '幅')], [marker(10, '長さ'), marker(null, '幅')])).toBe(1);
  expect(nominalMatched([marker(10, '幅')], [marker(11, '幅')])).toBe(0);
});
