export type LabelConfidence = {
  fhincd?: number;
  drawingNumber?: number;
  processName?: number;
  resourceCd?: number;
};

export type LabelCandidates = {
  fhincd?: string;
  drawingNumber?: string;
  processName?: string;
  resourceCd?: string;
  documentCategory?: string;
};

export type LabelingResult = {
  candidates: LabelCandidates;
  confidence: LabelConfidence;
  suggestedDisplayTitle?: string;
};

/**
 * OCR/抽出本文から業務メタ候補を推定するポート
 */
export interface MetadataLabelerPort {
  labelFromText(text: string): Promise<LabelingResult>;
}
