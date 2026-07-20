import clsx from 'clsx';

import { imageMarkerPositionPatch } from './imageMarkerPosition';

import type { ImageMarkerNudgeDirection, ImageMarkerPosition } from './imageMarkerPosition';

const DIRECTION_LABEL: Record<ImageMarkerNudgeDirection, string> = {
  up: '上へ移動',
  down: '下へ移動',
  left: '左へ移動',
  right: '右へ移動'
};

const DIRECTION_SYMBOL: Record<ImageMarkerNudgeDirection, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→'
};

const NUDGE_BUTTON_ORDER: ImageMarkerNudgeDirection[] = ['up', 'down', 'left', 'right'];

type Props = {
  position: ImageMarkerPosition;
  disabled?: boolean;
  groupLabel?: string;
  className?: string;
  onChange: (patch: ImageMarkerPosition) => void;
};

/** 業務型に依存しない、比率座標マーカーの4方向微調整UI。 */
export function ImageMarkerPositionNudge({
  position,
  disabled = false,
  groupLabel = 'マーカーの位置調整',
  className,
  onChange
}: Props) {
  return (
    <div
      className={clsx('flex w-full justify-center gap-1', className)}
      role="group"
      aria-label={groupLabel}
    >
      {NUDGE_BUTTON_ORDER.map((direction) => (
        <button
          key={direction}
          type="button"
          aria-label={DIRECTION_LABEL[direction]}
          disabled={disabled}
          className="inline-flex min-h-[1.375rem] min-w-11 items-center justify-center rounded border border-slate-300 bg-white px-2 py-0.5 text-sm font-bold leading-none text-slate-700 shadow-sm transition-colors hover:border-cyan-500 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onChange(imageMarkerPositionPatch(position, direction))}
        >
          {DIRECTION_SYMBOL[direction]}
        </button>
      ))}
    </div>
  );
}
