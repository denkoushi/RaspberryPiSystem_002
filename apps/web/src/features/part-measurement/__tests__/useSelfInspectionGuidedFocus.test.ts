import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SELF_INSPECTION_GUIDED_ZOOM } from '../selfInspectionGuidedFocus';
import { useSelfInspectionGuidedFocus } from '../useSelfInspectionGuidedFocus';

import {
  makeSelfInspectionSessionDetailForTest,
  makeSelfInspectionTemplateItemForTest
} from './selfInspectionSessionTestFixtures';

function makeMultiEntrySession() {
  const items = [
    makeSelfInspectionTemplateItemForTest({ id: 'p1', sortOrder: 0, displayMarker: '1' }),
    makeSelfInspectionTemplateItemForTest({ id: 'p2', sortOrder: 1, displayMarker: '2' })
  ];
  return makeSelfInspectionSessionDetailForTest({
    id: 'session-multi',
    items,
    expectedEntryCount: 3
  });
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
    expect(result.current.focusRequest?.zoom).toBe(SELF_INSPECTION_GUIDED_ZOOM);

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
    expect(result.current.focusRequest?.zoom).toBe(SELF_INSPECTION_GUIDED_ZOOM);

    act(() => {
      result.current.handleCommitValue({
        pointId: 'p1',
        entryIndex: 1,
        value: '10',
        source: 'enter'
      });
    });
    expect(result.current.focusRequest?.pointId).toBe('p2');
    expect(result.current.focusRequest?.zoom).toBe(SELF_INSPECTION_GUIDED_ZOOM);
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
        canvasZoom: 1.75
      })
    );

    act(() => {
      result.current.goToNextPointManual();
    });

    const lastCall = onZoomLevel.mock.calls.at(-1)?.[0];
    expect(lastCall).toBe(1.75);
    expect(lastCall).not.toBe(SELF_INSPECTION_GUIDED_ZOOM);
  });

  it('blur after consumeNextBlurGuideAdvance does not advance guided focus (save button path)', () => {
    const session = makeMultiEntrySession();
    const draftByEntry: Record<number, Record<string, string>> = {
      0: { p1: '', p2: '' }
    };
    let selectedPointId: string | null = null;

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
        onZoomLevel: vi.fn(),
        canvasZoom: 1
      })
    );

    expect(result.current.focusRequest?.pointId).toBe('p1');

    act(() => {
      result.current.consumeNextBlurGuideAdvance();
      result.current.handleCommitValue({
        pointId: 'p1',
        entryIndex: 0,
        value: '10',
        source: 'blur'
      });
    });

    expect(result.current.focusRequest?.pointId).toBe('p1');
    expect(result.current.guideMode).toBe('guided');
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
