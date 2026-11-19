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
  onRemove: (target: 'tip' | 'x' | 'y') => void;
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
  const hasX = calloutStatus?.dims?.some((dim) => dim.dir === 'x');
  const hasY = calloutStatus?.dims?.some((dim) => dim.dir === 'y');
  const nextDimMode = hasX && !hasY ? 'dimY' : 'dimX';

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
            <span className="flex shrink-0 items-center gap-1">
              {(['dimX', 'dimY'] as const).map((dir) => (
                <button key={dir} type="button" aria-pressed={mode === dir}
                  className={clsx('min-h-[26px] min-w-[26px] rounded px-1 text-[0.78rem] font-extrabold leading-none',
                    mode === dir ? 'bg-cyan-300 text-cyan-950' : 'border border-white/20 bg-slate-950 text-white/60')}
                  disabled={calloutStatus.disabled || !calloutStatus.hasCallout}
                  onClick={() => onModeChange(dir)}>{dir === 'dimX' ? 'X' : 'Y'}</button>
              ))}
            </span>
          ) : null}
          {calloutStatus.hasCallout ? (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {([
                { target: 'tip', label: '矢視', ariaLabel: '矢視を削除', visible: true },
                { target: 'x', label: 'X', ariaLabel: '寸法Xを削除', visible: hasX },
                { target: 'y', label: 'Y', ariaLabel: '寸法Yを削除', visible: hasY }
              ] as const).filter(({ visible }) => visible).map(({ target, label, ariaLabel }) => (
                <button
                  key={target}
                  type="button"
                  aria-label={ariaLabel}
                  disabled={calloutStatus.disabled}
                  className="inline-flex min-h-[26px] items-center gap-0.5 whitespace-nowrap rounded border border-amber-300/50 bg-slate-950/55 pl-1.5 pr-1 text-[0.7rem] font-extrabold text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => calloutStatus.onRemove(target)}
                >
                  {label}
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ))}
            </span>
          ) : (
            <span className="ml-auto shrink-0 whitespace-nowrap text-[0.7rem] font-extrabold text-amber-100/60">
              矢視 なし
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}
