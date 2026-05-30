/** 移行前テンプレート・シートの資源CDプレースホルダ */
export const PART_MEASUREMENT_LEGACY_RESOURCE_CD = '__LEGACY__';

/**
 * FHINMEI_ONLY 候補テンプレの DB 上の仮 FIHNCD（実品番とは別バケット）。
 * 一意性は processGroup + resourceCd（UUID相当）で担保する。
 */
export const PART_MEASUREMENT_FHINMEI_ONLY_BUCKET_FHINCD = '__FHINMEI_ONLY__';

/**
 * 検査図面 MVP の評価用テンプレの DB 上 FIHNCD（実品番・日程照会とは別バケット）。
 * 本番 THREE_KEY テンプレの isActive には触れない。
 */
export const PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD = '__INSPECTION_DRAWING_EVAL__';

/** FHINMEI_ONLY 候補キーの最短文字数（正規化後。誤ヒット抑制） */
export const PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN = 2;

/** 編集ロック TTL（ミリ秒）= 3分 */
export const PART_MEASUREMENT_EDIT_LOCK_TTL_MS = 3 * 60 * 1000;
