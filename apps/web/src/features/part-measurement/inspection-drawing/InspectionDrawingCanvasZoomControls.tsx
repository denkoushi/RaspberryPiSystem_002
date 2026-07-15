import { ImageCanvasZoomControls } from '../../kiosk/image-canvas';

import {
  inspectionDrawingCanvasZoomButtonClassName,
  inspectionDrawingCanvasZoomControlsClassName
} from './inspectionDrawingKioskUi';

type Props = {
  enabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
  onResetZoom?: () => void;
  /** 指定時: ネイティブ button + 親渡しクラス（Button/ghostOnDark を通さない） */
  getButtonClassName?: (disabled: boolean) => string;
};

/**
 * ヘッダーバンド中央余白用の図面ズーム操作（記号のみ・倍率表示なし）。
 */
export function InspectionDrawingCanvasZoomControls({
  enabled,
  onZoomIn,
  onZoomOut,
  onFitToView,
  onResetZoom,
  getButtonClassName
}: Props) {
  return (
    <ImageCanvasZoomControls
      enabled={enabled}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onFitToView={onFitToView}
      onResetZoom={onResetZoom}
      controlsClassName={inspectionDrawingCanvasZoomControlsClassName}
      buttonClassName={inspectionDrawingCanvasZoomButtonClassName}
      getButtonClassName={getButtonClassName}
    />
  );
}
