/**
 * CustomerSCAW / 生産日程 MH・SH 行の FHINMEI 照合キー。
 * NFKC + trim + 連続空白の単一化 + 大文字化。
 */
export function normalizeCustomerScawMatchKey(value: unknown): string {
  const raw = String(value ?? '');
  const nfkc = raw.normalize('NFKC').trim();
  const collapsed = nfkc.replace(/\s+/g, ' ');
  return collapsed.toUpperCase();
}
