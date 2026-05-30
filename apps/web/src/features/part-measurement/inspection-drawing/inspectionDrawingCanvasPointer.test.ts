import { describe, expect, it } from 'vitest';

import {
  INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX,
  shouldConfirmPlacePointFromPointerMovement
} from './inspectionDrawingCanvasPointer';

describe('shouldConfirmPlacePointFromPointerMovement', () => {
  it('confirms tap when movement is below threshold', () => {
    expect(shouldConfirmPlacePointFromPointerMovement(0)).toBe(true);
    expect(
      shouldConfirmPlacePointFromPointerMovement(
        INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX - 1
      )
    ).toBe(true);
  });

  it('rejects placement when movement exceeds threshold (pan)', () => {
    expect(
      shouldConfirmPlacePointFromPointerMovement(
        INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX
      )
    ).toBe(false);
    expect(shouldConfirmPlacePointFromPointerMovement(40)).toBe(false);
  });
});
