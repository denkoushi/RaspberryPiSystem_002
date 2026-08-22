import { describe, expect, it } from 'vitest';

import {
  canDiscardAssemblyProcedureDocumentRevision,
  canPublishAssemblyProcedureDocument,
  convertOverlayShapeKind,
  createOverlayForRange,
  normalizeOverlayBBox,
  overlayDraftReducer
  , updateOverlayBBox
} from './assemblyDocumentEditorDraft';

const bbox = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 };

describe('assembly document editor draft reducer', () => {
  it('defaults text and image ranges to a white mask', () => {
    expect(createOverlayForRange('TEXT', 0, bbox)).toMatchObject({
      kind: 'TEXT',
      mask: { enabled: true, color: '#ffffff' }
    });
    expect(createOverlayForRange('IMAGE', 0, bbox)).toMatchObject({
      kind: 'IMAGE',
      mask: { enabled: true, color: '#ffffff' }
    });
  });

  it('moves z-order within a page and clamps keyboard nudges', () => {
    const elements = [
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'back', zIndex: 0 },
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'front', zIndex: 1 },
      { ...createOverlayForRange('SHAPE', 1, bbox), id: 'other-page', zIndex: 0 }
    ];
    const raised = overlayDraftReducer(elements, { type: 'bringForward', id: 'back' });
    expect(raised.find((element) => element.id === 'back')?.zIndex).toBe(1);
    expect(raised.find((element) => element.id === 'front')?.zIndex).toBe(0);

    const nudged = overlayDraftReducer(
      [{ ...elements[0]!, bbox: { ...bbox, xRatio: 0.9, yRatio: 0.9 } }],
      { type: 'nudge', id: 'back', dxRatio: 0.2, dyRatio: 0.2 }
    );
    expect(nudged[0]?.bbox).toMatchObject({ xRatio: 0.8, yRatio: 0.8 });
  });

  it('allows a root draft to publish while keeping discard revision-only', () => {
    expect(canPublishAssemblyProcedureDocument({ status: 'draft', isRevisionHead: undefined }, false)).toBe(true);
    expect(canPublishAssemblyProcedureDocument({ status: 'draft', isRevisionHead: false }, false)).toBe(false);
    expect(canPublishAssemblyProcedureDocument({ status: 'draft', isRevisionHead: true }, true)).toBe(false);
    expect(canDiscardAssemblyProcedureDocumentRevision({ status: 'draft', supersedesDocumentId: null })).toBe(false);
    expect(canDiscardAssemblyProcedureDocumentRevision({ status: 'draft', supersedesDocumentId: 'base-1' })).toBe(true);
  });

  it('keeps bbox values inside the page with a positive minimum size', () => {
    expect(normalizeOverlayBBox({ xRatio: 0.9, yRatio: -1, widthRatio: 0.2, heightRatio: 2 })).toEqual({
      xRatio: 0.8,
      yRatio: 0,
      widthRatio: 0.2,
      heightRatio: 1
    });
  });

  it('preserves line endpoints in local coordinates when the bbox changes', () => {
    const line = {
      ...createOverlayForRange('SHAPE', 0, bbox),
      shape: 'LINE' as const,
      start: { xRatio: 0.1, yRatio: 0.3 },
      end: { xRatio: 0.3, yRatio: 0.4 }
    };
    const resized = updateOverlayBBox(line, { xRatio: 0.2, yRatio: 0.1, widthRatio: 0.4, heightRatio: 0.4 });
    expect(resized.bbox).toEqual({ xRatio: 0.2, yRatio: 0.1, widthRatio: 0.4, heightRatio: 0.4 });
    expect(resized.start?.xRatio).toBeCloseTo(0.2);
    expect(resized.start?.yRatio).toBeCloseTo(0.3);
    expect(resized.end?.xRatio).toBeCloseTo(0.6);
    expect(resized.end?.yRatio).toBeCloseTo(0.5);
  });

  it('creates endpoints for line variants and clears them for closed shapes', () => {
    const rectangle = createOverlayForRange('SHAPE', 0, bbox);
    const arrow = convertOverlayShapeKind(rectangle, 'ARROW');
    expect(arrow.start).toEqual({ xRatio: bbox.xRatio, yRatio: bbox.yRatio });
    expect(arrow.end).toEqual({ xRatio: bbox.xRatio + bbox.widthRatio, yRatio: bbox.yRatio + bbox.heightRatio });
    const ellipse = convertOverlayShapeKind(arrow, 'ELLIPSE');
    expect(ellipse.start).toBeUndefined();
    expect(ellipse.end).toBeUndefined();
  });
});
