import { extractInspectionDrawingAsciiDigits } from '@raspi-system/shared-types';

/** @deprecated 新規コードは shared-types の関数を直接利用する。 */
export const digitsOf = extractInspectionDrawingAsciiDigits;

/**
 * Digit-only partial match (includes).
 * Empty query matches everything.
 */
export function matchesDigitQuery(
  haystackText: string | null | undefined,
  digitQuery: string
): boolean {
  const query = extractInspectionDrawingAsciiDigits(digitQuery);
  if (!query) return true;
  return digitsOf(haystackText).includes(query);
}
