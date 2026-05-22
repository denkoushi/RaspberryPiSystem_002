import { KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS } from '../../hooks/kioskRevealUi';

/** 沉浸式ヘッダー: 下辺中央1/3 のマウスホットゾーン（14px = `KIOSK_HEADER_REVEAL_BAND_DEPTH_PX`）。 */
export const KIOSK_IMMERSIVE_HEADER_HOT_ZONE_CLASS =
  'pointer-events-auto fixed bottom-0 left-1/3 z-40 h-[14px] w-1/3';

/** 沉浸式ヘッダー本体の固定配置（下端・全幅）。 */
export const KIOSK_IMMERSIVE_HEADER_FIXED_CLASS = `fixed bottom-0 right-0 left-0 z-50 shadow-lg ${KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS}`;

/** 非表示時: スライドアウト + ヒットテスト無効（下辺全幅での誤リビール防止）。 */
export const KIOSK_IMMERSIVE_HEADER_HIDDEN_TRANSFORM_CLASS =
  'pointer-events-none invisible translate-y-full';
export const KIOSK_IMMERSIVE_HEADER_VISIBLE_TRANSFORM_CLASS =
  'pointer-events-auto visible translate-y-0';

/** 下端固定時は上辺ボーダーでコンテンツと分離。 */
export const KIOSK_IMMERSIVE_HEADER_BORDER_CLASS = 'border-t border-white/10';
