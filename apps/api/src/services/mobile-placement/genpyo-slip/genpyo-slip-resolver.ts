import { extractFseiban } from './genpyo-fseiban-extract.js';
import { parseManufacturingOrder10Extraction, type ParsedActualSlipIdentifiers } from './genpyo-mo-extract.js';

export function parseActualSlipIdentifiersFromOcrText(raw: string): ParsedActualSlipIdentifiers {
  const manufacturingOrder10 = parseManufacturingOrder10Extraction(raw).value;
  const fseiban = extractFseiban(raw);
  return { manufacturingOrder10, fseiban };
}
