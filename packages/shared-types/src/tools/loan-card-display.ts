/**
 * キオスク持出一覧・サイネージなどで、写真撮影持出（item なし・photoUrl あり）の1行目に使う表示名。
 * 文言変更時はここだけを更新する。
 */
export const PHOTO_LOAN_CARD_PRIMARY_LABEL = '撮影mode';

export type PhotoToolHumanLabelQuality = 'GOOD' | 'MARGINAL' | 'BAD';

/**
 * 写真持出の工具表示名の優先順位: 人レビュー上書き > VLM > フォールバック（通常は撮影mode）
 */
export function resolvePhotoLoanToolDisplayLabel(params: {
  humanDisplayName?: string | null;
  vlmDisplayName?: string | null;
  fallbackLabel: string;
}): string {
  const human = params.humanDisplayName?.trim();
  if (human) {
    return human;
  }
  const vlm = params.vlmDisplayName?.trim();
  if (vlm) {
    return vlm;
  }
  return params.fallbackLabel;
}
