/**
 * 配膳部品棚サイネージ用の表示キー正規化（検索用 normalizeMachineNameForPartSearch とは別契約）。
 */

export function toHalfWidthAscii(value: string): string {
  return value
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/** 機種名: 第1ハイフンより前を半角大文字化し、先頭10文字（コードポイント） */
export function machineTypeDisplayKey(raw: string): string {
  const trimmed = toHalfWidthAscii(raw.trim());
  const beforeHyphen = trimmed.includes('-') ? trimmed.split('-')[0] ?? '' : trimmed;
  const upper = beforeHyphen.toUpperCase();
  return [...upper].slice(0, 10).join('');
}

/** 製番: 文字列先頭5文字（可変長・英数字混在に対応） */
export function seibanHead5(fseiban: string): string {
  const s = fseiban.trim();
  return [...s].slice(0, 5).join('');
}

export function buildPartDisplayName(fields: {
  fhinmei: string;
  fhincd: string;
  productNo: string;
}): string {
  const mei = fields.fhinmei.trim();
  if (mei.length > 0) return mei;
  const cd = fields.fhincd.trim();
  if (cd.length > 0) return cd;
  const pn = fields.productNo.trim();
  if (pn.length > 0) return pn;
  return '（名称不明）';
}

