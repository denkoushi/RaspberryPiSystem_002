import {
  IMAGE_CANVAS_TAP_MOVE_THRESHOLD_PX,
  shouldConfirmImageCanvasTap
} from '../../kiosk/image-canvas';

/** 配置モード: この移動量（px）未満ならタップ、以上ならパン扱いで点を追加しない */
export const INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX =
  IMAGE_CANVAS_TAP_MOVE_THRESHOLD_PX;

export function shouldConfirmPlacePointFromPointerMovement(maxMovementPx: number): boolean {
  return shouldConfirmImageCanvasTap(maxMovementPx);
}
