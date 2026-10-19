/**
 * Areas arrive as free text (SharePoint location, kiosk input). Full-width and
 * half-width spellings such as `30041R_2ＭＦ-Ｐ` and `30041R_2MF-P` must be one area,
 * so every stored or compared area goes through NFKC, trimmed, with inner
 * whitespace collapsed.
 */
export function normalizeInventoryArea(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/** Unit names (個, ケース, ...) follow the same spelling rules as areas. */
export const normalizeInventoryUnit = normalizeInventoryArea;
