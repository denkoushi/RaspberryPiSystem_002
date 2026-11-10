import { describe, expect, it } from 'vitest';

import { createInspectionDrawingPoint, templateItemToDrawingPoint } from './markerNumbering';
import { filterExistingPlacementRows, numberPlacementProposals, proposalToDrawingPoint } from './proposalToDrawingPoint';

import type { DrawingPlacementProposal } from '../../../api/domains/part-measurement-placement';

const proposal: DrawingPlacementProposal = {
  id: 'proposal-1', sortOrder: 0, measurementLabel: '内径', measurementPoint: '内径（裏面）',
  nominalValue: 56, lowerLimit: 55.98, upperLimit: 56.03, decimalPlaces: 3,
  depthMode: 'measured', valueKind: 'numeric', markerXRatio: 0.3, markerYRatio: 0.4,
  anchorXRatio: null, anchorYRatio: null, dimensionText: 'Φ56 h7'
};

describe('proposalToDrawingPoint', () => {
  it.each([
    {},
    { lowerLimit: null, upperLimit: null },
    { depthMode: 'through' as const },
    { valueKind: 'judgement' as const }
  ])('uses the saved-item conversion for limits, supplements and modes: %j', (overrides) => {
    const row = { ...proposal, ...overrides };
    const point = proposalToDrawingPoint(row, [createInspectionDrawingPoint(0, 0, 1)], 0.3, 0.4);
    const saved = templateItemToDrawingPoint({
      ...row, id: 'saved-item', datumSurface: '', measurementPoint: row.measurementPoint ?? '',
      sortOrder: 1, displayMarker: '2', unit: 'mm', allowNegative: true,
      nominalValue: '56',
      lowerLimit: row.lowerLimit === null ? null : String(row.lowerLimit),
      upperLimit: row.upperLimit === null ? null : String(row.upperLimit),
      markerXRatio: String(0.3 + 0.03), markerYRatio: String(0.4 - 0.03),
      calloutTipXRatio: '0.3', calloutTipYRatio: '0.4'
    });
    expect(point).toEqual({ ...saved, id: point.id });
    expect(point.id).not.toBe(proposal.id);
    expect(point.id).not.toBe(saved.id);
    if (row.valueKind === 'numeric' && row.depthMode === 'measured' && row.lowerLimit !== null) {
      expect(point).toMatchObject({ nominalRaw: '56', lowerToleranceRaw: '-0.02', upperToleranceRaw: '0.03' });
    }
  });

  it('numbers proposals above the current maximum in proposal order, but approves into available gaps', () => {
    const points = [createInspectionDrawingPoint(0, 0, 1), createInspectionDrawingPoint(0, 0, 4)];
    const rows = [{ ...proposal, id: 'later', sortOrder: 5 }, proposal];
    expect(numberPlacementProposals(rows, points).map(({ id, markerNo }) => ({ id, markerNo })))
      .toEqual([{ id: proposal.id, markerNo: 5 }, { id: 'later', markerNo: 6 }]);
    expect(proposalToDrawingPoint(proposal, points, 0.3, 0.4).markerNo).toBe(2);
    expect(numberPlacementProposals([proposal], [])[0].markerNo).toBe(1);
    expect(rows[0].id).toBe('later');
    expect(numberPlacementProposals([{ ...proposal, markerXRatio: null }], [])).toEqual([]);
  });

  it('filters only the same label and numeric nominal, including unsaved points', () => {
    const point = proposalToDrawingPoint(proposal, [], 0.3, 0.4);
    expect(filterExistingPlacementRows([proposal], [{ ...point, nominalRaw: '56.000' }])).toEqual([]);
    expect(filterExistingPlacementRows([proposal], [{ ...point, name: '外径' }])).toEqual([proposal]);
    expect(filterExistingPlacementRows([proposal], [{ ...point, nominalRaw: '57' }])).toEqual([proposal]);
    expect(filterExistingPlacementRows([{ ...proposal, nominalValue: 0 }], [{ ...point, nominalRaw: '' }]))
      .toHaveLength(1);
  });
});
