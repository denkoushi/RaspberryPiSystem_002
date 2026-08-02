import { ImageMarkerPositionNudge } from '../../kiosk/image-canvas';

import { inspectionDrawingSopTargetProps } from './inspectionDrawingSopAnnotations';

import type { InspectionDrawingPoint } from './types';

type Props = {
  point: InspectionDrawingPoint;
  disabled?: boolean;
  onChange: (patch: Pick<InspectionDrawingPoint, 'xRatio' | 'yRatio'>) => void;
};

/** 測定点設定の既存公開名。表示と動作は共通 image-canvas へ委譲する。 */
export function InspectionDrawingPointPositionNudge({ point, disabled = false, onChange }: Props) {
  return (
    <div {...inspectionDrawingSopTargetProps('nudge-point')}>
      <ImageMarkerPositionNudge
        position={point}
        disabled={disabled}
        groupLabel="測定点の位置調整"
        onChange={onChange}
      />
    </div>
  );
}
