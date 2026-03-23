/**
 * 手動順番・上ペイン端末カードの表示用純関数（UI から分離しテスト可能にする）
 */

export type ManualOrderCardResourceSubtitleParts = {
  /** 空のときは2行目で名称区間を省略する */
  displayName: string;
  resourceCd: string;
  assignedCount: number;
};

/**
 * 資源マスタ由来の名称配列を、カード2行目左側に載せる1文字列へ正規化する。
 * 複数名称は現場で「同じCDの別表記」が並ぶことがあるため " / " で連結する。
 */
export function joinManualOrderResourceDisplayNames(
  resourceNames: readonly string[] | undefined | null
): string {
  if (!resourceNames?.length) return '';
  return resourceNames
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0)
    .join(' / ');
}

/**
 * カード2行目用。`displayName` は呼び出し側で `joinManualOrderResourceDisplayNames` 等により解決済みとする。
 */
export function buildManualOrderCardResourceSubtitleParts(params: {
  resourceCd: string;
  assignedCount: number;
  displayName: string;
}): ManualOrderCardResourceSubtitleParts {
  return {
    displayName: params.displayName.trim(),
    resourceCd: params.resourceCd.trim(),
    assignedCount: Number.isFinite(params.assignedCount) ? params.assignedCount : 0
  };
}
