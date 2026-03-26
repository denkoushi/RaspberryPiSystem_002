import type { MetadataLabelerPort, LabelingResult } from '../ports/metadata-labeler.port.js';

const FHINCD_PATTERN = /\b([A-Z0-9]{4,20})\b/g;
const DRAWING_PATTERN = /\b([A-Z]{1,4}-?\d{2,8}(?:-\d{1,4})?)\b/g;
const RESOURCE_CD_PATTERN = /(?:resource|資源(?:cd)?|機械)\s*[:：]?\s*([A-Z0-9]{1,12})/i;
const PROCESS_PATTERN = /(旋盤|研削|切削|組立|検査|溶接|塗装|熱処理)/;

function pickFirstMatch(text: string, pattern: RegExp): string | undefined {
  const m = text.match(pattern);
  if (!m || m.length === 0) return undefined;
  return m[0];
}

function pickFhincd(text: string): string | undefined {
  const matched = text.match(FHINCD_PATTERN) ?? [];
  return matched.find((v) => /\d/.test(v) && /[A-Z]/.test(v));
}

function pickDrawingNumber(text: string): string | undefined {
  const matched = text.match(DRAWING_PATTERN) ?? [];
  return matched[0];
}

function buildSuggestedTitle(params: {
  drawingNumber?: string;
  fhincd?: string;
  processName?: string;
}): string | undefined {
  const parts = [params.drawingNumber, params.fhincd, params.processName].filter((v) => Boolean(v && v.length > 0));
  if (parts.length === 0) return undefined;
  return parts.join(' - ');
}

export class RegexMetadataLabelerAdapter implements MetadataLabelerPort {
  async labelFromText(text: string): Promise<LabelingResult> {
    const fhincd = pickFhincd(text);
    const drawingNumber = pickDrawingNumber(text);
    const processName = pickFirstMatch(text, PROCESS_PATTERN);
    const resourceCd = text.match(RESOURCE_CD_PATTERN)?.[1];

    return {
      candidates: {
        fhincd,
        drawingNumber,
        processName,
        resourceCd,
        documentCategory: drawingNumber ? '図面' : '要領書',
      },
      confidence: {
        fhincd: fhincd ? 0.9 : 0.1,
        drawingNumber: drawingNumber ? 0.9 : 0.1,
        processName: processName ? 0.8 : 0.1,
        resourceCd: resourceCd ? 0.8 : 0.1,
      },
      suggestedDisplayTitle: buildSuggestedTitle({ drawingNumber, fhincd, processName }),
    };
  }
}
