import { Button } from '../../../components/ui/Button';

import {
  inspectionDrawingCanvasZoomButtonClassName,
  inspectionDrawingCanvasZoomControlsClassName
} from './inspectionDrawingKioskUi';

type Props = {
  enabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
};

/**
 * ヘッダーバンド中央余白用の図面ズーム操作（記号のみ・倍率表示なし）。
 */
export function InspectionDrawingCanvasZoomControls({
  enabled,
  onZoomIn,
  onZoomOut,
  onFitToView
}: Props) {
  return (
    <div className={inspectionDrawingCanvasZoomControlsClassName}>
      <Button
        type="button"
        variant="ghostOnDark"
        className={inspectionDrawingCanvasZoomButtonClassName}
        aria-label="縮小"
        disabled={!enabled}
        onClick={onZoomOut}
      >
        −
      </Button>
      <Button
        type="button"
        variant="ghostOnDark"
        className={inspectionDrawingCanvasZoomButtonClassName}
        aria-label="拡大"
        disabled={!enabled}
        onClick={onZoomIn}
      >
        ＋
      </Button>
      <Button
        type="button"
        variant="ghostOnDark"
        className={inspectionDrawingCanvasZoomButtonClassName}
        aria-label="全面表示"
        disabled={!enabled}
        onClick={onFitToView}
      >
        □
      </Button>
    </div>
  );
}
