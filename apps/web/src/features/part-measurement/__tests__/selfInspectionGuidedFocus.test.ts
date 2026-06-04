import { describe, expect, it } from 'vitest';

import { resolveInspectionDrawingZoomFromDefaultSteps } from '../inspection-drawing/inspectionDrawingZoom';
import { templateItemToDrawingPoint } from '../inspection-drawing/markerNumbering';
import {
  applySelfInspectionGuidedCommit,
  buildEntryDrawingPoints,
  findFirstGuidedPointId,
  findFirstPendingPointId,
  findNextGuidedPointIdAfter,
  resolvePointInputStatus,
  resolveResumeGuidedFocusTarget,
  resolveSelfInspectionGuidedZoom,
  shouldAdvanceGuideOnCommit,
  sortPointsByMarkerNoStable,
  SELF_INSPECTION_GUIDED_ZOOM,
  SELF_INSPECTION_GUIDED_ZOOM_STEPS
} from '../selfInspectionGuidedFocus';

import type { PartMeasurementTemplateItemDto, SelfInspectionSessionDetailDto } from '../types';

function makeItem(
  overrides: Partial<PartMeasurementTemplateItemDto> & { id: string; sortOrder: number }
): PartMeasurementTemplateItemDto {
  return {
    datumSurface: '',
    measurementPoint: '',
    measurementLabel: '測定',
    displayMarker: String(overrides.sortOrder + 1),
    unit: 'mm',
    allowNegative: false,
    decimalPlaces: 2,
    markerXRatio: '0.5',
    markerYRatio: '0.5',
    nominalValue: '10',
    lowerLimit: '9',
    upperLimit: '11',
    ...overrides
  };
}

function makeSession(items: PartMeasurementTemplateItemDto[]): SelfInspectionSessionDetailDto {
  return {
    id: 'session-1',
    templateId: 'tpl-1',
    productNo: 'P1',
    fseiban: 'S1',
    resourceCd: 'R1',
    fhincd: 'H1',
    fhinmei: '品名',
    processGroup: 'cutting',
    selfInspectionMode: 'single',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    plannedQuantity: 1,
    expectedEntryCount: 1,
    requiredEntryCount: 1,
    completedEntryCount: 0,
    completedAt: null,
    entryCountBlockedReason: null,
    template: {
      id: 'tpl-1',
      fhincd: 'H1',
      resourceCd: 'R1',
      processGroup: 'cutting',
      name: 'tpl',
      version: 1,
      isActive: true,
      selfInspectionMode: 'single',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplateId: 'vt-1',
      visualTemplate: null,
      items
    },
    entries: [],
    focusedEntry: null
  } as SelfInspectionSessionDetailDto;
}

describe('selfInspectionGuidedFocus', () => {
  it('guided zoom matches default + SELF_INSPECTION_GUIDED_ZOOM_STEPS', () => {
    expect(resolveSelfInspectionGuidedZoom()).toBe(
      resolveInspectionDrawingZoomFromDefaultSteps(SELF_INSPECTION_GUIDED_ZOOM_STEPS)
    );
    expect(SELF_INSPECTION_GUIDED_ZOOM).toBe(1.5);
  });

  it('sorts by markerNo then template sortOrder then id', () => {
    const items = [
      makeItem({ id: 'b', sortOrder: 1, displayMarker: '2' }),
      makeItem({ id: 'a', sortOrder: 0, displayMarker: '1' }),
      makeItem({ id: 'c', sortOrder: 2, displayMarker: '2' })
    ];
    const withMarker = [
      { ...templateItemToDrawingPoint(items[0], ''), markerNo: 2 },
      { ...templateItemToDrawingPoint(items[1], ''), markerNo: 1 },
      { ...templateItemToDrawingPoint(items[2], ''), markerNo: 2 }
    ];
    const sorted = sortPointsByMarkerNoStable(withMarker, items);
    expect(sorted.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('findFirstPendingPointId returns smallest pending markerNo', () => {
    const items = [
      makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
      makeItem({ id: 'p3', sortOrder: 2, displayMarker: '3' }),
      makeItem({ id: 'p2', sortOrder: 1, displayMarker: '2' })
    ];
    const session = makeSession(items);
    const draft = { p1: '10', p2: '', p3: '' };
    const points = buildEntryDrawingPoints(session, draft);
    expect(findFirstPendingPointId(points, items)).toBe('p2');
  });

  it('findFirstPendingPointId returns null when all points are OK', () => {
    const items = [
      makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
      makeItem({ id: 'p2', sortOrder: 1, displayMarker: '2' })
    ];
    const session = makeSession(items);
    const draft = { p1: '10', p2: '10' };
    const points = buildEntryDrawingPoints(session, draft);
    expect(findFirstPendingPointId(points, items)).toBeNull();
  });

  it('findFirstGuidedPointId focuses No.1 when all points are empty', () => {
    const items = [
      makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
      makeItem({ id: 'p2', sortOrder: 1, displayMarker: '2' })
    ];
    const session = makeSession(items);
    const draft = { p1: '', p2: '' };
    const points = buildEntryDrawingPoints(session, draft);
    expect(findFirstGuidedPointId(points, items)).toBe('p1');
  });

  it('resolveResumeGuidedFocusTarget returns null when all points are OK', () => {
    const items = [
      makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
      makeItem({ id: 'p2', sortOrder: 1, displayMarker: '2' })
    ];
    const session = makeSession(items);
    expect(
      resolveResumeGuidedFocusTarget({
        session,
        draft: { p1: '10', p2: '10' },
        requestId: 1
      })
    ).toBeNull();
  });

  it('advances on OK commit and skips to next pending marker', () => {
    const items = [
      makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
      makeItem({ id: 'p2', sortOrder: 1, displayMarker: '2' })
    ];
    const session = makeSession(items);
    const result = applySelfInspectionGuidedCommit({
      session,
      entryIndex: 0,
      currentDraft: { p1: '', p2: '' },
      commit: { pointId: 'p1', entryIndex: 0, value: '10', source: 'dropdown' },
      nextFocusRequestId: 2
    });
    expect(result.kind).toBe('advance');
    if (result.kind === 'advance') {
      expect(result.next?.pointId).toBe('p2');
      expect(result.next?.zoom).toBe(SELF_INSPECTION_GUIDED_ZOOM);
      expect(result.next?.focusRequest.requestId).toBe(2);
      expect(result.next?.focusRequest.zoom).toBe(SELF_INSPECTION_GUIDED_ZOOM);
    }
  });

  it('stays on NG commit', () => {
    const items = [makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' })];
    const session = makeSession(items);
    const result = applySelfInspectionGuidedCommit({
      session,
      entryIndex: 0,
      currentDraft: { p1: '' },
      commit: { pointId: 'p1', entryIndex: 0, value: '99', source: 'enter' },
      nextFocusRequestId: 1
    });
    expect(result.kind).toBe('stay');
    if (result.kind === 'stay') {
      expect(result.inputStatus).toBe('ng');
    }
  });

  it('returns null next when all points are OK after commit', () => {
    const items = [makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' })];
    const session = makeSession(items);
    const result = applySelfInspectionGuidedCommit({
      session,
      entryIndex: 0,
      currentDraft: { p1: '' },
      commit: { pointId: 'p1', entryIndex: 0, value: '10', source: 'blur' },
      nextFocusRequestId: 5
    });
    expect(result.kind).toBe('advance');
    if (result.kind === 'advance') {
      expect(result.next).toBeNull();
    }
  });

  it('does not advance on manual_switch source', () => {
    const items = [
      makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
      makeItem({ id: 'p2', sortOrder: 1, displayMarker: '2' })
    ];
    const session = makeSession(items);
    const result = applySelfInspectionGuidedCommit({
      session,
      entryIndex: 0,
      currentDraft: { p1: '10', p2: '' },
      commit: { pointId: 'p2', entryIndex: 0, value: '10', source: 'manual_switch' },
      nextFocusRequestId: 1
    });
    expect(result.kind).toBe('stay');
  });

  it('resolvePointInputStatus reports tolerance_error when bounds missing', () => {
    const item = makeItem({
      id: 'p1',
      sortOrder: 0,
      nominalValue: null,
      lowerLimit: null,
      upperLimit: null
    });
    const point = templateItemToDrawingPoint(item, '10');
    expect(resolvePointInputStatus(point)).toBe('tolerance_error');
  });

  it('findNextGuidedPointIdAfter skips OK points', () => {
    const items = [
      makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
      makeItem({ id: 'p2', sortOrder: 1, displayMarker: '2' }),
      makeItem({ id: 'p3', sortOrder: 2, displayMarker: '3' })
    ];
    const session = makeSession(items);
    const draft = { p1: '10', p2: '10', p3: '' };
    const points = buildEntryDrawingPoints(session, draft);
    expect(findNextGuidedPointIdAfter(points, items, 'p1')).toBe('p3');
  });

  it('resolveResumeGuidedFocusTarget uses guided zoom', () => {
    const items = [makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' })];
    const session = makeSession(items);
    const target = resolveResumeGuidedFocusTarget({
      session,
      draft: { p1: '' },
      requestId: 10
    });
    expect(target?.pointId).toBe('p1');
    expect(target?.zoom).toBe(SELF_INSPECTION_GUIDED_ZOOM);
    expect(target?.focusRequest.requestId).toBe(10);
  });

  it('shouldAdvanceGuideOnCommit excludes blur_without_guide', () => {
    expect(shouldAdvanceGuideOnCommit('blur')).toBe(true);
    expect(shouldAdvanceGuideOnCommit('blur_without_guide')).toBe(false);
  });
});
