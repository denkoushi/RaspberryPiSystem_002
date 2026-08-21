import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from './constants.js';

/**
 * 機種名の解決結果として保存・再利用できない値を判定する。
 * 空値と未登録ラベルは、後続のMH/SH・補完CSV同期で解決可能な未解決値として扱う。
 */
export function isMissingSeibanMachineName(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 || normalized === SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL;
}

/**
 * セッションへ保存する機種名を正規化する。
 * 未解決ラベルを正本値として永続化せず、一覧取得時の再解決へ委ねる。
 */
export function normalizeSeibanMachineNameForPersistence(
  value: string | null | undefined
): string | null {
  return isMissingSeibanMachineName(value) ? null : (value ?? null);
}
