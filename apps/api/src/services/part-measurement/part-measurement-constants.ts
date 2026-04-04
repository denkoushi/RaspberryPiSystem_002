/** 移行前テンプレート・シートの資源CDプレースホルダ */
export const PART_MEASUREMENT_LEGACY_RESOURCE_CD = '__LEGACY__';

/**
 * FHINMEI_ONLY 候補テンプレの DB 上の仮 FIHNCD（実品番とは別バケット）。
 * 一意性は processGroup + resourceCd（UUID相当）で担保する。
 */
export const PART_MEASUREMENT_FHINMEI_ONLY_BUCKET_FHINCD = '__FHINMEI_ONLY__';

/** 編集ロック TTL（ミリ秒）= 3分 */
export const PART_MEASUREMENT_EDIT_LOCK_TTL_MS = 3 * 60 * 1000;
