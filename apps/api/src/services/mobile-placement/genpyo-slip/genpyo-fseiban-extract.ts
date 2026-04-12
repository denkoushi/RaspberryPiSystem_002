/**
 * 製番（FSEIBAN）候補抽出。
 */

import { normalizeDigitsFullWidthToHalfWidth } from './genpyo-field-normalize.js';

export function extractFseiban(text: string): string | null {
  const n = normalizeDigitsFullWidthToHalfWidth(text).replace(/\u3000/g, ' ');

  const labeled = n.match(/(?:製番|製\s*番)\s*[:：]?\s*([A-Za-z0-9]{6,14})/u);
  if (labeled) {
    return labeled[1].toUpperCase();
  }

  const loose = n.match(/\b([A-Z][A-Z0-9]{5,11})\b/);
  if (loose) {
    return loose[1].toUpperCase();
  }
  return null;
}
