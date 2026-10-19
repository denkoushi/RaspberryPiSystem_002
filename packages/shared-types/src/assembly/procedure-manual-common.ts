export const PROCEDURE_MANUAL_KANA_ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'] as const;
export type ProcedureManualKanaRow = typeof PROCEDURE_MANUAL_KANA_ROWS[number];

/** Same NFKC/trim/Latin-uppercase boundary as part keys; spaces in names collapse. */
export function normalizeProcedureManualCommonSubject(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').replace(/\p{Script=Latin}/gu, char => char.toUpperCase());
}

export function deriveProcedureManualKanaRow(value: string): ProcedureManualKanaRow | null {
  const first = value.normalize('NFKC').trim().normalize('NFD')[0];
  if (!first) return null;
  const code = first.codePointAt(0)!;
  const kana = code >= 0x30a1 && code <= 0x30fa ? String.fromCodePoint(code - 0x60) : first;
  const groups = ['あいうえおぁぃぅぇぉ', 'かきくけこゕゖㇰ', 'さしすせそㇱㇲ', 'たちつてとっㇳ', 'なにぬねのㇴ', 'はひふへほㇵㇶㇷㇸㇹ', 'まみむめもㇺ', 'やゆよゃゅょ', 'らりるれろㇻㇼㇽㇾㇿ', 'わをんゎゐゑ'];
  const index = groups.findIndex(group => group.includes(kana));
  return index < 0 ? null : PROCEDURE_MANUAL_KANA_ROWS[index];
}
