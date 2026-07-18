import { describe, expect, it } from 'vitest';

import { imageMarkerPositionPatch } from '../kiosk/image-canvas';

import type { AssemblyDraftBolt, AssemblyDraftCheckItem } from './assemblyTemplateDraft';

describe('assembly marker position patches', () => {
  it('changes only bolt coordinates and preserves its identity, condition, page, and callout tip', () => {
    const bolt: AssemblyDraftBolt = {
      id: 'bolt-1',
      sortOrder: 4,
      tighteningId: 'internal-1',
      markerNo: 12,
      xRatio: 0.4,
      yRatio: 0.6,
      calloutTipXRatio: 0.8,
      calloutTipYRatio: 0.2,
      boltSpec: 'M8x30',
      nominalDiameter: 'M8',
      boltLengthMm: 30,
      material: 'SCM435',
      strengthClass: '10.9',
      capabilityGroupId: 'capability-1',
      nominalTorque: 24,
      lowerLimit: 22,
      upperLimit: 26,
      unit: 'N·m',
      assemblyProcedureDocumentId: 'document-1',
      pageIndex: 3
    };

    const next = { ...bolt, ...imageMarkerPositionPatch(bolt, 'right') };
    expect(next).toEqual({ ...bolt, xRatio: 0.4025 });
  });

  it('changes only check-marker coordinates and preserves its number, page, and callout tip', () => {
    const checkItem: AssemblyDraftCheckItem = {
      id: 'check-1',
      markerNo: 5,
      label: '割ピン確認',
      required: true,
      xRatio: 0.2,
      yRatio: 0.3,
      calloutTipXRatio: 0.75,
      calloutTipYRatio: 0.65,
      sortOrder: 2,
      kioskDocumentId: 'kiosk-document-1',
      pageIndex: 1
    };

    const next = { ...checkItem, ...imageMarkerPositionPatch(checkItem, 'up') };
    expect(next).toEqual({ ...checkItem, yRatio: 0.2975 });
  });
});
