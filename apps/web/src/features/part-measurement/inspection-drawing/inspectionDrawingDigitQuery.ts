/** Extract ASCII digits from an identifier (品番 / 図面名). */
export function digitsOf(text: string | null | undefined): string {
  return String(text ?? '').replace(/\D/g, '');
}

/**
 * Digit-only partial match (includes).
 * Empty query matches everything.
 */
export function matchesDigitQuery(
  haystackText: string | null | undefined,
  digitQuery: string
): boolean {
  const query = digitQuery.replace(/\D/g, '');
  if (!query) return true;
  return digitsOf(haystackText).includes(query);
}
