import { buildActualSlipOcrPreviewSafe } from './actual-slip-ocr-preview.js';
import { snapFseiban } from './fseiban-snap.js';
import { extractManufacturingOrder10 } from './genpyo-mo-extract.js';

export function snapNativeSlip(tokens: string[], text: string, known: string[]) {
  const manufacturingOrder10 = extractManufacturingOrder10(text);
  const fseibanRaw = tokens[0] ?? '';
  const snap = snapFseiban(tokens, known);
  return { engine: 'device' as const, ocrText: text,
    ocrPreviewSafe: buildActualSlipOcrPreviewSafe(manufacturingOrder10 ?? '', fseibanRaw),
    manufacturingOrder10, fseibanRaw, fseibanMatch: snap.match,
    fseibanCandidates: snap.candidates, fseiban: snap.fseiban ?? fseibanRaw };
}
