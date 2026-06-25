export type SelfInspectionPaperOcrCandidateValue = {
  entryIndex: number;
  templateItemId: string;
  value: string | number | null;
  confidence?: number | null;
};

export type SelfInspectionPaperOcrInput = {
  imageBytes: Buffer;
  pageNumber: number;
};

export type SelfInspectionPaperOcrResult = {
  values: SelfInspectionPaperOcrCandidateValue[];
  engine: string;
};

export interface SelfInspectionPaperOcrPort {
  recognize(input: SelfInspectionPaperOcrInput): Promise<SelfInspectionPaperOcrResult>;
}

export class NoopSelfInspectionPaperOcrAdapter implements SelfInspectionPaperOcrPort {
  async recognize(): Promise<SelfInspectionPaperOcrResult> {
    return {
      values: [],
      engine: 'noop'
    };
  }
}
