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

const IMMERSIVE_PATH_EXACT = new Set([
  '/kiosk/tag',
  '/kiosk/instruments/borrow',
  '/kiosk/rigging/borrow',
  '/kiosk/production-schedule',
  '/kiosk/documents',
  '/kiosk/part-measurement'
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
  if (p.startsWith(KIOSK_PROGRESS_OVERVIEW_PATH_PREFIX)) return true;
  return IMMERSIVE_PATH_EXACT.has(p);
}
