/**
 * ROI ごとの OCR テキストから製造order・FSEIBAN を集約する。
 * 製造orderは右上ヘッダ優先、欠落時のみ下段（次工程）を参照。
 */

import { extractFseiban } from './genpyo-fseiban-extract.js';
import {
  parseManufacturingOrder10Extraction,
  type ManufacturingOrder10ParseDiagnostics,
  type ParsedActualSlipIdentifiers
} from './genpyo-mo-extract.js';

export type GenpyoSlipRegionOcrTexts = {
  moHeader: string;
  fseibanMain: string;
  moFooter: string;
};

export type GenpyoSlipResolution = {
  manufacturingOrder10: string | null;
  fseiban: string | null;
  moDiagnostics: ManufacturingOrder10ParseDiagnostics;
  /** どの ROI の抽出結果を製造orderに採用したか */
  moResolvedFromRoi: 'moHeader' | 'moFooter' | null;
};

function resolveFseibanWithFallback(regions: GenpyoSlipRegionOcrTexts): string | null {
  return (
    extractFseiban(regions.fseibanMain) ??
    extractFseiban(regions.moHeader) ??
    extractFseiban(regions.moFooter)
  );
}

export function resolveGenpyoSlipFromRegionTexts(regions: GenpyoSlipRegionOcrTexts): GenpyoSlipResolution {
  const resolvedFseiban = resolveFseibanWithFallback(regions);
  const headerMo = parseManufacturingOrder10Extraction(regions.moHeader);
  if (headerMo.value) {
    return {
      manufacturingOrder10: headerMo.value,
      fseiban: resolvedFseiban,
      moDiagnostics: headerMo.diagnostics,
      moResolvedFromRoi: 'moHeader'
    };
  }

  const footerMo = parseManufacturingOrder10Extraction(regions.moFooter);
  if (footerMo.value) {
    return {
      manufacturingOrder10: footerMo.value,
      fseiban: resolvedFseiban,
      moDiagnostics: footerMo.diagnostics,
      moResolvedFromRoi: 'moFooter'
    };
  }

  return {
    manufacturingOrder10: null,
    fseiban: resolvedFseiban,
    moDiagnostics: footerMo.diagnostics,
    moResolvedFromRoi: null
  };
}

export function parseActualSlipIdentifiersFromOcrText(raw: string): ParsedActualSlipIdentifiers {
  const manufacturingOrder10 = parseManufacturingOrder10Extraction(raw).value;
  const fseiban = extractFseiban(raw);
  return { manufacturingOrder10, fseiban };
}
