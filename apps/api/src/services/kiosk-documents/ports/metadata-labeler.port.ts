export type LabelConfidence = {
  fhincd?: number;
  drawingNumber?: number;
  processName?: number;
  resourceCd?: number;
  documentNumber?: number;
};

export type LabelCandidates = {
  fhincd?: string;
  drawingNumber?: string;
  processName?: string;
  resourceCd?: string;
  documentCategory?: string;
  documentNumber?: string;
};

export type LabelingResult = {
  candidates: LabelCandidates;
  confidence: LabelConfidence;
  suggestedDisplayTitle?: string;
  summaryCandidates?: [string?, string?, string?];
};

/**
 * OCR/抽出本文から業務メタ候補を推定するポート
 */
export interface MetadataLabelerPort {
  labelFromText(text: string): Promise<LabelingResult>;
}
