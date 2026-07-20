/** 1 押しあたりの比率移動量。ズーム倍率には依存しない。 */
export const IMAGE_MARKER_NUDGE_STEP_RATIO = 0.0025;

export type ImageMarkerNudgeDirection = 'up' | 'down' | 'left' | 'right';

export type ImageMarkerPosition = {
  xRatio: number;
  yRatio: number;
};

/** 比率座標を 0..1 に収め、有限 number 以外は 0 に収束させる。 */
export function clampImageMarkerRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

const NUDGE_DELTA: Record<ImageMarkerNudgeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
};

/** 元の業務オブジェクトを変更せず、座標だけを移動した値を返す。 */
export function nudgeImageMarkerPosition<T extends ImageMarkerPosition>(
  position: T,
  direction: ImageMarkerNudgeDirection,
  stepRatio: number = IMAGE_MARKER_NUDGE_STEP_RATIO
): T {
  const { dx, dy } = NUDGE_DELTA[direction];
  return {
    ...position,
    xRatio: clampImageMarkerRatio(position.xRatio + dx * stepRatio),
    yRatio: clampImageMarkerRatio(position.yRatio + dy * stepRatio)
  };
}

/** UI の onChange へ渡す、座標以外を含まない patch。 */
export function imageMarkerPositionPatch(
  position: ImageMarkerPosition,
  direction: ImageMarkerNudgeDirection,
  stepRatio: number = IMAGE_MARKER_NUDGE_STEP_RATIO
): ImageMarkerPosition {
  const next = nudgeImageMarkerPosition(position, direction, stepRatio);
  return { xRatio: next.xRatio, yRatio: next.yRatio };
}
