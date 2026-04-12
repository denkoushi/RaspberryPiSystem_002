/**
 * 現品票 OCR テキストから製造order（10桁）と製番（FSEIBAN）候補を抽出する純関数。
 * 実装は `genpyo-slip/` に分離（Schema/ROI パイプラインと共有）。
 */

export type { ParsedActualSlipIdentifiers } from './genpyo-slip/genpyo-mo-extract.js';
export {
  normalizeDigitsFullWidthToHalfWidth,
  collapseInterDigitWhitespace,
  fixAdjacentOcrDigitConfusion,
  prepareOcrTextForManufacturingOrderExtraction
} from './genpyo-slip/genpyo-field-normalize.js';
export {
  parseManufacturingOrder10Extraction,
  extractManufacturingOrder10,
  type ManufacturingOrder10ParseDiagnostics,
  type ManufacturingOrder10ParseSource
} from './genpyo-slip/genpyo-mo-extract.js';
export { extractFseiban } from './genpyo-slip/genpyo-fseiban-extract.js';
export { parseActualSlipIdentifiersFromOcrText } from './genpyo-slip/genpyo-slip-resolver.js';
