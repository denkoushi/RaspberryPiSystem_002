import { useEffect } from 'react';

import { inspectionDrawingPointHasCalloutTip } from './inspectionDrawingCalloutTip';

import type { InspectionDrawingToolbarMode } from './InspectionDrawingCreateToolbar';
import type { InspectionDrawingPoint } from './types';

/** 寸法線モード中に選択中の丸数字が指差し先端を失ったら、丸数字モードへ戻す */
export function useInspectionDrawingDimensionModeReset(
  mode: InspectionDrawingToolbarMode,
  setMode: (mode: InspectionDrawingToolbarMode) => void,
  selectedPoint: Pick<InspectionDrawingPoint, 'calloutTipXRatio' | 'calloutTipYRatio'> | null
): void {
  useEffect(() => {
    if ((mode === 'dimX' || mode === 'dimY') && (!selectedPoint || !inspectionDrawingPointHasCalloutTip(selectedPoint))) {
      setMode('place');
    }
  }, [mode, selectedPoint, setMode]);
}
