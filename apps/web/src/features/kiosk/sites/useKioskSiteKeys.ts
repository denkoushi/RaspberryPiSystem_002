import { useKioskSites } from '../../../api/hooks';

/**
 * サーバーの拠点一覧（Site）を取得できるまでの選択肢。以前の固定一覧と同じ並び。
 * docs/plans/explicit-site-scope-execplan.md Milestone 3b
 */
export const KIOSK_FALLBACK_SITE_KEYS: readonly string[] = ['第2工場', 'トークプラザ', '第1工場'];
export const KIOSK_DEFAULT_SITE_KEY = KIOSK_FALLBACK_SITE_KEYS[0];

/** 管理画面で登録した拠点の一覧。取得前・失敗時は固定の選択肢に戻す。 */
export function useKioskSiteKeys(options?: { enabled?: boolean }): readonly string[] {
  const query = useKioskSites(options);
  const keys = query.data?.map((site) => site.key) ?? [];
  return keys.length > 0 ? keys : KIOSK_FALLBACK_SITE_KEYS;
}
