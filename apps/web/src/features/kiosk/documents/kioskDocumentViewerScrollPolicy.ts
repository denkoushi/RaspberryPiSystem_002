/**
 * 要領書ビューア: 近傍行の画像マウント範囲（Pi 実機で重い場合はここを調整）
 */
export const KIOSK_DOC_NEAR_VISIBLE_RADIUS = 3;

/** IntersectionObserver の rootMargin（先読みバッファ） */
export const KIOSK_DOC_IO_ROOT_MARGIN = '400px 0px';

/** 交差率の閾値（段数を抑えてコールバック頻度を下げる） */
export const KIOSK_DOC_IO_THRESHOLDS: number[] = [0, 1];
