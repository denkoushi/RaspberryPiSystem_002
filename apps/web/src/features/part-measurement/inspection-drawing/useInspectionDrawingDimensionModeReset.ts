import { useEffect } from 'react';

import { inspectionDrawingPointHasCalloutTip } from './inspectionDrawingCalloutTip';

import type { InspectionDrawingToolbarMode } from './InspectionDrawingCreateToolbar';
import type { InspectionDrawingCalloutDim, InspectionDrawingPoint } from './types';

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

/** 寸法線を保存し、寸法線モード中ならもう一方の向きが未配置ならその向きへ、そろったら丸数字モードへ移すハンドラを作る */
export function createInspectionDrawingCalloutDimsChangeHandler(
  mode: InspectionDrawingToolbarMode,
  setMode: (mode: InspectionDrawingToolbarMode) => void,
  updatePoint: (id: string, patch: { calloutDims: InspectionDrawingCalloutDim[] }) => void
): (id: string, dims: InspectionDrawingCalloutDim[]) => void {
  return (id, dims) => {
    updatePoint(id, { calloutDims: dims });
    if (mode !== 'dimX' && mode !== 'dimY') return;
    const missing = mode === 'dimX' ? 'y' : 'x';
    setMode(dims.some((dim) => dim.dir === missing) ? 'place' : missing === 'x' ? 'dimX' : 'dimY');
  };
}
