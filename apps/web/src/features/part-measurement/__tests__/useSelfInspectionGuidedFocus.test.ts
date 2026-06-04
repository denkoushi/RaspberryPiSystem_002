import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SELF_INSPECTION_GUIDED_ZOOM } from '../selfInspectionGuidedFocus';
import { useSelfInspectionGuidedFocus } from '../useSelfInspectionGuidedFocus';

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

function makeMultiEntrySession(): SelfInspectionSessionDetailDto {
  const items = [
    makeItem({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
    makeItem({ id: 'p2', sortOrder: 1, displayMarker: '2' })
  ];
  return {
    id: 'session-multi',
    templateId: 'tpl-1',
    productNo: 'P1',
    fseiban: 'S1',
    resourceCd: 'R1',
    fhincd: 'H1',
    fhinmei: '品名',
    processGroup: 'cutting',
    selfInspectionMode: 'full',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    plannedQuantity: 3,
    expectedEntryCount: 3,
    requiredEntryCount: 3,
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
      selfInspectionMode: 'full',
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

describe('useSelfInspectionGuidedFocus', () => {
  it('entry 0 auto-starts guided; entry 1 stays manual until resume; advance works after resume', () => {
    const session = makeMultiEntrySession();
    const draftByEntry: Record<number, Record<string, string>> = {
      0: { p1: '', p2: '' },
      1: { p1: '', p2: '' }
    };
    let selectedPointId: string | null = null;
    let zoom = 1;

    const { result, rerender } = renderHook(
      (props: { entryIndex: number }) =>
        useSelfInspectionGuidedFocus({
          session,
          selectedEntryIndex: props.entryIndex,
          selectedPointId,
          draftValuesByEntryIndex: draftByEntry,
          isSessionReadOnly: false,
          isDrawingCanvasReady: true,
          isDraftReadyForGuidedFocus: true,
          onDraftChange: (entryIndex, draft) => {
            draftByEntry[entryIndex] = draft;
          },
          onSelectPointId: (id) => {
            selectedPointId = id;
          },
          onZoomLevel: (z) => {
            zoom = z;
          },
          canvasZoom: zoom
        }),
      { initialProps: { entryIndex: 0 } }
    );

    expect(result.current.guideMode).toBe('guided');
    expect(result.current.focusRequest?.pointId).toBe('p1');
    expect(zoom).toBe(SELF_INSPECTION_GUIDED_ZOOM);

    act(() => {
      result.current.handleEntrySwitch();
    });
    rerender({ entryIndex: 1 });

    expect(result.current.guideMode).toBe('manual');
    expect(result.current.focusRequest).toBeNull();

    act(() => {
      result.current.handleCommitValue({
        pointId: 'p1',
        entryIndex: 1,
        value: '10',
        source: 'enter'
      });
    });
    expect(result.current.guideMode).toBe('manual');

    act(() => {
      result.current.resumeGuided();
    });
    expect(result.current.guideMode).toBe('guided');
    expect(result.current.focusRequest?.pointId).toBe('p1');
    expect(zoom).toBe(SELF_INSPECTION_GUIDED_ZOOM);

    act(() => {
      result.current.handleCommitValue({
        pointId: 'p1',
        entryIndex: 1,
        value: '10',
        source: 'enter'
      });
    });
    expect(result.current.focusRequest?.pointId).toBe('p2');
  });

  it('goToNextPointManual keeps current canvas zoom', () => {
    const session = makeMultiEntrySession();
    const draftByEntry: Record<number, Record<string, string>> = {
      0: { p1: '', p2: '' }
    };
    let selectedPointId: string | null = 'p1';
    const onZoomLevel = vi.fn();

    const { result } = renderHook(() =>
      useSelfInspectionGuidedFocus({
        session,
        selectedEntryIndex: 0,
        selectedPointId,
        draftValuesByEntryIndex: draftByEntry,
        isSessionReadOnly: false,
        isDrawingCanvasReady: true,
        isDraftReadyForGuidedFocus: true,
        onDraftChange: (entryIndex, draft) => {
          draftByEntry[entryIndex] = draft;
        },
        onSelectPointId: (id) => {
          selectedPointId = id;
        },
        onZoomLevel,
        canvasZoom: 2
      })
    );

    act(() => {
      result.current.goToNextPointManual();
    });

    const lastCall = onZoomLevel.mock.calls.at(-1)?.[0];
    expect(lastCall).toBe(2);
    expect(lastCall).not.toBe(SELF_INSPECTION_GUIDED_ZOOM);
  });

  it('enterManualAfterPersist forces manual without advancing guide', () => {
    const session = makeMultiEntrySession();
    const draftByEntry: Record<number, Record<string, string>> = {
      0: { p1: '10', p2: '' }
    };
    let selectedPointId: string | null = 'p2';

    const { result } = renderHook(() =>
      useSelfInspectionGuidedFocus({
        session,
        selectedEntryIndex: 0,
        selectedPointId,
        draftValuesByEntryIndex: draftByEntry,
        isSessionReadOnly: false,
        isDrawingCanvasReady: true,
        isDraftReadyForGuidedFocus: true,
        onDraftChange: (entryIndex, draft) => {
          draftByEntry[entryIndex] = draft;
        },
        onSelectPointId: (id) => {
          selectedPointId = id;
        },
        onZoomLevel: () => {},
        canvasZoom: SELF_INSPECTION_GUIDED_ZOOM
      })
    );

    act(() => {
      result.current.resumeGuided();
    });
    expect(result.current.guideMode).toBe('guided');

    act(() => {
      result.current.enterManualAfterPersist();
    });
    expect(result.current.guideMode).toBe('manual');
    expect(result.current.focusRequest).toBeNull();
  });
});
