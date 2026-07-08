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

const NUDGE_BUTTON_ORDER: InspectionDrawingNudgeDirection[] = ['up', 'down', 'left', 'right'];

/** 測定点設定 — 方向ボタンで図面上の位置を微調整 */
export function InspectionDrawingPointPositionNudge({ point, disabled = false, onChange }: Props) {
  const handleNudge = (direction: InspectionDrawingNudgeDirection) => {
    onChange(inspectionDrawingPointPositionPatch(point, direction));
  };

  return (
    <div className={inspectionDrawingPointNudgeGridClassName} role="group" aria-label="測定点の位置調整">
      {NUDGE_BUTTON_ORDER.map((direction) => (
        <NudgeButton
          key={direction}
          direction={direction}
          disabled={disabled}
          onClick={() => handleNudge(direction)}
        />
      ))}
    </div>
  );
}
