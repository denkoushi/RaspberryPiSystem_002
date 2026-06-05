import clsx from 'clsx';

import {
  inspectionDrawingKioskDisabledButtonClass,
  inspectionDrawingPointNudgeButtonClassName,
  inspectionDrawingPointNudgeGridClassName
} from './inspectionDrawingKioskUi';
import {
  inspectionDrawingPointPositionPatch,
  type InspectionDrawingNudgeDirection
} from './inspectionDrawingPointPosition';

import type { InspectionDrawingPoint } from './types';

const DIRECTION_LABEL: Record<InspectionDrawingNudgeDirection, string> = {
  up: '上へ移動',
  down: '下へ移動',
  left: '左へ移動',
  right: '右へ移動'
};

const DIRECTION_SYMBOL: Record<InspectionDrawingNudgeDirection, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→'
};

type Props = {
  point: InspectionDrawingPoint;
  disabled?: boolean;
  onChange: (patch: Pick<InspectionDrawingPoint, 'xRatio' | 'yRatio'>) => void;
};

function NudgeButton({
  direction,
  disabled,
  onClick
}: {
  direction: InspectionDrawingNudgeDirection;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={DIRECTION_LABEL[direction]}
      disabled={disabled}
      className={clsx(
        inspectionDrawingPointNudgeButtonClassName,
        inspectionDrawingKioskDisabledButtonClass
      )}
      onClick={onClick}
    >
      {DIRECTION_SYMBOL[direction]}
    </button>
  );
}

/** 測定点設定 — 十字ボタンで図面上の位置を微調整 */
export function InspectionDrawingPointPositionNudge({ point, disabled = false, onChange }: Props) {
  const handleNudge = (direction: InspectionDrawingNudgeDirection) => {
    onChange(inspectionDrawingPointPositionPatch(point, direction));
  };

  return (
    <div className={inspectionDrawingPointNudgeGridClassName} role="group" aria-label="測定点の位置調整">
      <span className="col-start-2 row-start-1">
        <NudgeButton direction="up" disabled={disabled} onClick={() => handleNudge('up')} />
      </span>
      <span className="col-start-1 row-start-2">
        <NudgeButton direction="left" disabled={disabled} onClick={() => handleNudge('left')} />
      </span>
      <span
        className="col-start-2 row-start-2 flex min-h-11 min-w-11 items-center justify-center text-[0.72rem] font-semibold text-white/45"
        aria-hidden
      >
        位置
      </span>
      <span className="col-start-3 row-start-2">
        <NudgeButton direction="right" disabled={disabled} onClick={() => handleNudge('right')} />
      </span>
      <span className="col-start-2 row-start-3">
        <NudgeButton direction="down" disabled={disabled} onClick={() => handleNudge('down')} />
      </span>
    </div>
  );
}
