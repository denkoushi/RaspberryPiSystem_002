import { KIOSK_LEADER_ORDER_BOARD_PATH_PREFIX } from './leaderOrderBoard/kioskLeaderOrderBoardRoutes';
import { KIOSK_MANUAL_ORDER_PATH_PREFIX } from './manualOrder/kioskManualOrderRoutes';

/** 進捗一覧（および将来の子パス）を沉浸式に含める接頭辞 */
const KIOSK_PROGRESS_OVERVIEW_PATH_PREFIX = '/kiosk/production-schedule/progress-overview';

/** 負荷調整（山崩し支援）専用画面 */
const KIOSK_LOAD_BALANCING_PATH_PREFIX = '/kiosk/production-schedule/load-balancing';

/**
 * pathname 末尾のスラッシュを除いたキオスクパス（空は `/`）。
 */
export function normalizeKioskPathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return '/';
  const noTrail = trimmed.replace(/\/+$/, '');
  return noTrail || '/';
}

/** 子パスを含めて沉浸式にする接頭辞 */
const KIOSK_PART_MEASUREMENT_PREFIX = '/kiosk/part-measurement';

const KIOSK_MOBILE_PLACEMENT_PREFIX = '/kiosk/mobile-placement';

const KIOSK_PURCHASE_ORDER_LOOKUP_PREFIX = '/kiosk/purchase-order-lookup';

/** パレット可視化: 左・右の独立スクロールのためビューポート高を `h-dvh` で固定する */
const KIOSK_PALLET_VISUALIZATION_PREFIX = '/kiosk/pallet-visualization';

/** 持出タブ系（TAG / PHOTO / 計測・吊具）— キオスクナビは下端中央1/3リビールに統一 */
const KIOSK_BORROW_IMMERSIVE_PATH_EXACT = [
  '/kiosk/tag',
  '/kiosk/photo',
  '/kiosk/instruments/borrow',
  '/kiosk/rigging/borrow'
] as const;

const IMMERSIVE_PATH_EXACT = new Set<string>([
  ...KIOSK_BORROW_IMMERSIVE_PATH_EXACT,
  '/kiosk/production-schedule',
  '/kiosk/documents'
]);

/**
 * キオスクで「下辺中央1/3ホバーでヘッダーを出す」沉浸式レイアウト（全画面 flex + main flex-1）を使うか。
 *
 * - allowlist のみ（計画納期・通話などは含めない）。持出タブ（`/kiosk/tag`・`/kiosk/photo` 等）は下端リビールに統一。
 * - マウス操作前提。`useKioskBottomCenterHeaderReveal` と併用。
 *
 * ルート追加時は本モジュールと `kioskImmersiveLayoutPolicy.test.ts` を更新する。
 */
export function usesKioskImmersiveLayout(pathname: string): boolean {
  const p = normalizeKioskPathname(pathname);
  if (p.startsWith(KIOSK_MANUAL_ORDER_PATH_PREFIX)) return true;
  if (p.startsWith(KIOSK_LEADER_ORDER_BOARD_PATH_PREFIX)) return true;
  if (p.startsWith(KIOSK_PROGRESS_OVERVIEW_PATH_PREFIX)) return true;
  if (p.startsWith(KIOSK_LOAD_BALANCING_PATH_PREFIX)) return true;
  if (p === KIOSK_PART_MEASUREMENT_PREFIX || p.startsWith(`${KIOSK_PART_MEASUREMENT_PREFIX}/`)) return true;
  if (p === KIOSK_MOBILE_PLACEMENT_PREFIX || p.startsWith(`${KIOSK_MOBILE_PLACEMENT_PREFIX}/`)) return true;
  if (p === KIOSK_PURCHASE_ORDER_LOOKUP_PREFIX || p.startsWith(`${KIOSK_PURCHASE_ORDER_LOOKUP_PREFIX}/`)) return true;
  if (p === KIOSK_PALLET_VISUALIZATION_PREFIX || p.startsWith(`${KIOSK_PALLET_VISUALIZATION_PREFIX}/`)) return true;
  return IMMERSIVE_PATH_EXACT.has(p);
}
