import { describe, expect, it } from 'vitest';

import {
  applyAssemblyBoltConditionRange,
  copyAssemblyBoltCondition,
  createAssemblyBoltAt,
  emptyAssemblyArea,
  nextAssemblyMarkerNo
} from './assemblyTemplateDraft';

describe('assembly template condition reuse', () => {
  it('uses the smallest unused marker number across all areas without renumbering existing markers', () => {
    const a = emptyAssemblyArea(0);
    const b = emptyAssemblyArea(1);
    a.bolts = [createAssemblyBoltAt(a, 0.1, 0.1), createAssemblyBoltAt(a, 0.2, 0.2)];
    a.bolts[0].markerNo = 1;
    a.bolts[1].markerNo = 3;
    b.bolts = [createAssemblyBoltAt(b, 0.3, 0.3)];
    b.bolts[0].markerNo = 4;
    expect(nextAssemblyMarkerNo([a, b])).toBe(2);
  });

  it('copies only condition fields and preserves identity, marker, page, coordinates and callout', () => {
    const area = emptyAssemblyArea();
    const source = createAssemblyBoltAt(area, 0.1, 0.2);
    source.nominalDiameter = 'M10';
    source.lowerLimit = 28;
    source.nominalTorque = 30;
    source.upperLimit = 32;
    const target = createAssemblyBoltAt(area, 0.8, 0.9, {
      source: 'assembly_procedure_document',
      documentId: 'doc-2',
      pageIndex: 3
    });
    target.markerNo = 35;
    target.calloutTipXRatio = 0.7;
    target.calloutTipYRatio = 0.6;

    const copied = copyAssemblyBoltCondition(source, target);
    expect(copied).toMatchObject({
      id: target.id,
      markerNo: 35,
      xRatio: 0.8,
      yRatio: 0.9,
      pageIndex: 3,
      calloutTipXRatio: 0.7,
      nominalDiameter: 'M10',
      nominalTorque: 30
    });
  });

  it('updates existing markers in a range, skips gaps, and reports both counts', () => {
    const area = emptyAssemblyArea();
    area.bolts = [1, 2, 4].map((markerNo, index) => ({
      ...createAssemblyBoltAt(area, index / 10, index / 10),
      markerNo
    }));
    area.bolts[0].nominalTorque = 42;
    const result = applyAssemblyBoltConditionRange([area], area.bolts[0].id, 1, 4);
    expect(result.updatedCount).toBe(2);
    expect(result.missingCount).toBe(1);
    expect(result.areas[0].bolts.map((bolt) => bolt.nominalTorque)).toEqual([42, 42, 42]);
    expect(result.areas[0].bolts.map((bolt) => bolt.markerNo)).toEqual([1, 2, 4]);
  });
});
