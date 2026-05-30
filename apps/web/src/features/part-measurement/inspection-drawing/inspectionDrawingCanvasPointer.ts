/** 配置モード: この移動量（px）未満ならタップ、以上ならパン扱いで点を追加しない */
export const INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX = 10;

export function shouldConfirmPlacePointFromPointerMovement(maxMovementPx: number): boolean {
  return maxMovementPx < INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX;
}
