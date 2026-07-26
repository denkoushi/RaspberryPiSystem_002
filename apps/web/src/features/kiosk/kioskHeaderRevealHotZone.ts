/** 沉浸式キオスクヘッダーの右下ホットゾーン一辺（px）。 */
export const KIOSK_HEADER_REVEAL_HOT_ZONE_SIZE_PX = 24;

export type KioskHeaderRevealEdge = 'top' | 'bottom';

export type KioskHeaderRevealHorizontalBand = 'full' | 'center-third' | 'right-fixed';

export type KioskHeaderRevealHotZoneConfig = {
  edge: KioskHeaderRevealEdge;
  bandDepthPx: number;
  horizontalBand: KioskHeaderRevealHorizontalBand;
  horizontalWidthPx?: number;
};

export type PointerInKioskHeaderRevealHotZoneInput = {
  clientX: number;
  clientY: number;
  viewportWidth: number;
  viewportHeight: number;
} & KioskHeaderRevealHotZoneConfig;

/** 右下24×24px の沉浸式ヘッダーリビール（現行キオスク正本）。 */
export const BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_HOT_ZONE: KioskHeaderRevealHotZoneConfig = {
  edge: 'bottom',
  bandDepthPx: KIOSK_HEADER_REVEAL_HOT_ZONE_SIZE_PX,
  horizontalBand: 'right-fixed',
  horizontalWidthPx: KIOSK_HEADER_REVEAL_HOT_ZONE_SIZE_PX
};

function isWithinHorizontalBand(
  clientX: number,
  viewportWidth: number,
  horizontalBand: KioskHeaderRevealHorizontalBand,
  horizontalWidthPx?: number
): boolean {
  if (horizontalBand === 'full') {
    return clientX >= 0 && clientX <= viewportWidth;
  }
  const xMin =
    horizontalBand === 'right-fixed'
      ? viewportWidth - Math.max(horizontalWidthPx ?? 0, 0)
      : viewportWidth / 3;
  const xMax = horizontalBand === 'right-fixed' ? viewportWidth : (2 * viewportWidth) / 3;
  return clientX >= xMin && clientX <= xMax;
}

function isWithinVerticalEdgeBand(
  clientY: number,
  viewportHeight: number,
  edge: KioskHeaderRevealEdge,
  bandDepthPx: number
): boolean {
  if (edge === 'top') {
    return clientY >= 0 && clientY < bandDepthPx;
  }
  return clientY >= viewportHeight - bandDepthPx && clientY <= viewportHeight;
}

/**
 * ポインタがキオスクヘッダーリビール用ホットゾーン内か（純関数・テスト可能）。
 */
export function isPointerInKioskHeaderRevealHotZone(
  input: PointerInKioskHeaderRevealHotZoneInput
): boolean {
  const {
    clientX,
    clientY,
    viewportWidth,
    viewportHeight,
    edge,
    bandDepthPx,
    horizontalBand,
    horizontalWidthPx
  } =
    input;
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return false;
  }
  return (
    isWithinVerticalEdgeBand(clientY, viewportHeight, edge, bandDepthPx) &&
    isWithinHorizontalBand(clientX, viewportWidth, horizontalBand, horizontalWidthPx)
  );
}
