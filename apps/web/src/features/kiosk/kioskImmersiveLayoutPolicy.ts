import { KIOSK_LEADER_ORDER_BOARD_PATH_PREFIX } from './leaderOrderBoard/kioskLeaderOrderBoardRoutes';
import { KIOSK_MANUAL_ORDER_PATH_PREFIX } from './manualOrder/kioskManualOrderRoutes';

/** 進捗一覧（および将来の子パス）を沉浸式に含める接頭辞 */
const KIOSK_PROGRESS_OVERVIEW_PATH_PREFIX = '/kiosk/production-schedule/progress-overview';

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

const IMMERSIVE_PATH_EXACT = new Set([
  '/kiosk/tag',
  '/kiosk/instruments/borrow',
  '/kiosk/rigging/borrow',
  '/kiosk/production-schedule',
  '/kiosk/documents'
]);

/**
 * キオスクで「上端ホバーでヘッダーを出す」沉浸式レイアウト（全画面 flex + main flex-1）を使うか。
 *
 * - allowlist のみ（`/kiosk/photo`・計画納期・通話などは含めない）。
 * - マウス操作前提。`useKioskTopEdgeHeaderReveal` と併用。
 *
 * ルート追加時は本モジュールと `kioskImmersiveLayoutPolicy.test.ts` を更新する。
 */
export function usesKioskImmersiveLayout(pathname: string): boolean {
  const p = normalizeKioskPathname(pathname);
  if (p.startsWith(KIOSK_MANUAL_ORDER_PATH_PREFIX)) return true;
  if (p.startsWith(KIOSK_LEADER_ORDER_BOARD_PATH_PREFIX)) return true;
  if (p.startsWith(KIOSK_PROGRESS_OVERVIEW_PATH_PREFIX)) return true;
  if (p === KIOSK_PART_MEASUREMENT_PREFIX || p.startsWith(`${KIOSK_PART_MEASUREMENT_PREFIX}/`)) return true;
  return IMMERSIVE_PATH_EXACT.has(p);
}
