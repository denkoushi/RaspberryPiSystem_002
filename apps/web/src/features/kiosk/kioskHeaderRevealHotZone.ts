/** 沉浸式キオスクヘッダーのエッジホットゾーン深さ（px）。左ドロワー帯と共通。 */
export const KIOSK_HEADER_REVEAL_BAND_DEPTH_PX = 14;

export type KioskHeaderRevealEdge = 'top' | 'bottom';

export type KioskHeaderRevealHorizontalBand = 'full' | 'center-third';

export type KioskHeaderRevealHotZoneConfig = {
  edge: KioskHeaderRevealEdge;
  bandDepthPx: number;
  horizontalBand: KioskHeaderRevealHorizontalBand;
};

export type PointerInKioskHeaderRevealHotZoneInput = {
  clientX: number;
  clientY: number;
  viewportWidth: number;
  viewportHeight: number;
} & KioskHeaderRevealHotZoneConfig;

/** 下端・中央1/3 の沉浸式ヘッダーリビール（現行キオスク正本）。 */
export const BOTTOM_CENTER_KIOSK_HEADER_REVEAL_HOT_ZONE: KioskHeaderRevealHotZoneConfig = {
  edge: 'bottom',
  bandDepthPx: KIOSK_HEADER_REVEAL_BAND_DEPTH_PX,
  horizontalBand: 'center-third'
};

function isWithinHorizontalBand(
  clientX: number,
  viewportWidth: number,
  horizontalBand: KioskHeaderRevealHorizontalBand
): boolean {
  if (horizontalBand === 'full') {
    return clientX >= 0 && clientX <= viewportWidth;
  }
  const xMin = viewportWidth / 3;
  const xMax = (2 * viewportWidth) / 3;
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
  const { clientX, clientY, viewportWidth, viewportHeight, edge, bandDepthPx, horizontalBand } =
    input;
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return false;
  }
  return (
    isWithinVerticalEdgeBand(clientY, viewportHeight, edge, bandDepthPx) &&
    isWithinHorizontalBand(clientX, viewportWidth, horizontalBand)
  );
}
