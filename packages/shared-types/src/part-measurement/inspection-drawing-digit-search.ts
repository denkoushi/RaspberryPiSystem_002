/**
 * 検査図面名・検索語から ASCII 数字だけを順序どおり抽出する。
 * PostgreSQL migration の `regexp_replace(value, '[^0-9]', '', 'g')` と同じ契約。
 */
export function extractInspectionDrawingAsciiDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/[^0-9]/g, '');
}
