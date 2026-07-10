import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

import {
  inspectionDrawingKioskDisabledButtonClass,
  inspectionDrawingKioskToggleInactiveClass,
  inspectionDrawingPlaceCalloutModeRowClassName
} from './inspectionDrawingKioskUi';

import type { InspectionDrawingToolbarMode } from './InspectionDrawingCreateToolbar';

export type InspectionDrawingPlaceCalloutMode = Extract<
  InspectionDrawingToolbarMode,
  'place' | 'callout'
>;

export type InspectionDrawingCalloutStatusProps = {
  hasCallout: boolean;
  onClear: () => void;
  disabled?: boolean;
};

type Props = {
  mode: InspectionDrawingToolbarMode;
  onModeChange: (mode: InspectionDrawingPlaceCalloutMode) => void;
  hasDrawingImage: boolean;
  hasMeasurementPoints: boolean;
  calloutStatus?: InspectionDrawingCalloutStatusProps | null;
};

/** 右ペイン: 丸数字 / 矢視 切替 +（任意）矢視状態・削除 */
export function InspectionDrawingPlaceCalloutModeRow({
  mode,
  onModeChange,
  hasDrawingImage,
  hasMeasurementPoints,
  calloutStatus = null
}: Props) {
  const toggleClass = (isActive: boolean) =>
    clsx(
      inspectionDrawingKioskToggleInactiveClass(isActive),
      inspectionDrawingKioskDisabledButtonClass,
      '!min-h-[26px] !px-1.5 !py-0 text-[0.72rem] leading-none'
    );
  const placeDisabled = !hasDrawingImage;
  const calloutDisabled = !hasDrawingImage || !hasMeasurementPoints;
  const placeActive = mode === 'place';
  const calloutActive = mode === 'callout';

  return (
    <div
      className={inspectionDrawingPlaceCalloutModeRowClassName}
      data-testid="inspection-drawing-place-callout-mode-row"
    >
      <Button
        type="button"
        variant="primary"
        aria-pressed={placeActive}
        className={toggleClass(placeActive)}
        disabled={placeDisabled}
        onClick={() => onModeChange('place')}
      >
        丸数字
      </Button>
      <Button
        type="button"
        variant="primary"
        aria-pressed={calloutActive}
        className={toggleClass(calloutActive)}
        disabled={calloutDisabled}
        onClick={() => onModeChange('callout')}
      >
        矢視
      </Button>
      {calloutStatus ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[0.7rem] font-extrabold text-amber-100">
            {calloutStatus.hasCallout ? '矢視 あり' : '矢視 なし'}
          </span>
          <button
            type="button"
            disabled={calloutStatus.disabled || !calloutStatus.hasCallout}
            className="min-h-[26px] shrink-0 rounded border border-amber-300/50 bg-slate-950/55 px-2 text-[0.7rem] font-extrabold text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={calloutStatus.onClear}
          >
            削除
          </button>
        </>
      ) : null}
    </div>
  );
}
