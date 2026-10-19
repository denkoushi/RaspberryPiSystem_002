import { describe, expect, it } from 'vitest';

import { createOverlayForRange as createSharedOverlayForRange } from '../overlays/overlayDraft';

import {
  createWorkInstructionOverlayForRange,
  overlayElementsForStep,
  workInstructionOverlayDraftReducer,
  workInstructionOverlayDraftSnapshot
} from './workInstructionEditorDraft';

describe('work instruction overlay draft', () => {
  it('uses WI-only creation defaults while preserving shared overlay defaults', () => {
    const bbox = { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 };
    const workInstructionText = createWorkInstructionOverlayForRange('TEXT', 0, 'step-1', bbox);
    const workInstructionShape = createWorkInstructionOverlayForRange('SHAPE', 0, 'step-1', bbox);
    const sharedText = createSharedOverlayForRange('TEXT', 0, bbox);
    const sharedShape = createSharedOverlayForRange('SHAPE', 0, bbox);

    expect(workInstructionText.style?.fontSizeRatio).toBe(0.0125);
    expect(workInstructionShape.strokeWidthRatio).toBe(0.016);
    expect(sharedText.style?.fontSizeRatio).toBe(0.025);
    expect(sharedShape.strokeWidthRatio).toBe(0.008);
  });

  it('keeps step ownership while applying neutral nudge and z-order operations', () => {
    const first = createWorkInstructionOverlayForRange('TEXT', 0, 'sp:list:10:1', {
      xRatio: 0.8,
      yRatio: 0.8,
      widthRatio: 0.1,
      heightRatio: 0.1
    });
    const second = {
      ...createWorkInstructionOverlayForRange('SHAPE', 0, 'sp:list:10:1', {
        xRatio: 0.1,
        yRatio: 0.1,
        widthRatio: 0.1,
        heightRatio: 0.1
      }),
      zIndex: 1
    };
    const moved = workInstructionOverlayDraftReducer([first, second], {
      type: 'nudge',
      id: first.id,
      dxRatio: 0.5,
      dyRatio: 0.5
    });
    expect(moved.find((element) => element.id === first.id)?.bbox).toEqual({
      xRatio: 0.9,
      yRatio: 0.9,
      widthRatio: 0.1,
      heightRatio: 0.1
    });
    const raised = workInstructionOverlayDraftReducer(moved, { type: 'bringForward', id: first.id });
    expect(raised.find((element) => element.id === first.id)?.zIndex).toBe(1);
    expect(raised.find((element) => element.id === second.id)?.zIndex).toBe(0);
    expect(overlayElementsForStep(raised, 'sp:list:10:1', 0)).toHaveLength(2);
  });

  it('produces a stable snapshot regardless of element insertion order', () => {
    const first = createWorkInstructionOverlayForRange('TEXT', 0, 'a', { xRatio: 0, yRatio: 0, widthRatio: 0.1, heightRatio: 0.1 });
    const second = createWorkInstructionOverlayForRange('SHAPE', 0, 'b', { xRatio: 0, yRatio: 0, widthRatio: 0.1, heightRatio: 0.1 });
    expect(workInstructionOverlayDraftSnapshot([first, second])).toBe(workInstructionOverlayDraftSnapshot([second, first]));
  });
});
