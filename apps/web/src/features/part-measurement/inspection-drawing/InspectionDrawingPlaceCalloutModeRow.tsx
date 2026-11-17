import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

import {
  inspectionDrawingKioskDisabledButtonClass,
  inspectionDrawingKioskToggleInactiveClass,
  inspectionDrawingPlaceCalloutModeRowClassName
} from './inspectionDrawingKioskUi';
import { inspectionDrawingSopTargetProps } from './inspectionDrawingSopAnnotations';

import type { InspectionDrawingToolbarMode } from './InspectionDrawingCreateToolbar';

export type InspectionDrawingPlaceCalloutMode = Extract<
  InspectionDrawingToolbarMode,
  'place' | 'callout' | 'dimX' | 'dimY'
>;

export type InspectionDrawingCalloutStatusProps = {
  hasCallout: boolean;
  dims?: { dir: 'x' | 'y' }[];
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
  const dimActive = mode === 'dimX' || mode === 'dimY';
  const dirs = (calloutStatus?.dims ?? []).map((dim) => dim.dir.toUpperCase()).sort().join('');
  const nextDimMode = dirs === 'X' ? 'dimY' : 'dimX';

  return (
    <div
      className={inspectionDrawingPlaceCalloutModeRowClassName}
      data-testid="inspection-drawing-place-callout-mode-row"
    >
      <Button
        {...inspectionDrawingSopTargetProps('add-point')}
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
        {...inspectionDrawingSopTargetProps('place-callout')}
        type="button"
        variant="primary"
        aria-pressed={calloutActive}
        className={toggleClass(calloutActive)}
        disabled={calloutDisabled}
        onClick={() => onModeChange('callout')}
      >
        矢視
      </Button>
      <Button
        type="button"
        variant="primary"
        aria-pressed={dimActive}
        className={toggleClass(dimActive)}
        disabled={calloutDisabled || !calloutStatus?.hasCallout || calloutStatus.disabled}
        onClick={() => onModeChange(nextDimMode)}
      >
        寸法
      </Button>
      {calloutStatus ? (
        <>
          {dimActive ? (
            <span className="flex flex-1 shrink-0 items-center gap-1">
              {(['dimX', 'dimY'] as const).map((dir) => (
                <button key={dir} type="button" aria-pressed={mode === dir}
                  className={clsx('min-h-[26px] min-w-[26px] rounded px-1 text-[0.78rem] font-extrabold leading-none',
                    mode === dir ? 'bg-cyan-300 text-cyan-950' : 'border border-white/20 bg-slate-950 text-white/60')}
                  disabled={calloutStatus.disabled || !calloutStatus.hasCallout}
                  onClick={() => onModeChange(dir)}>{dir === 'dimX' ? 'X' : 'Y'}</button>
              ))}
            </span>
          ) : (
            <span className="flex-1 shrink-0 whitespace-nowrap text-[0.7rem] font-extrabold text-amber-100">
              {calloutStatus.hasCallout ? (dirs ? `矢視・寸法${dirs}` : '矢視 あり') : '矢視 なし'}
            </span>
          )}
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
