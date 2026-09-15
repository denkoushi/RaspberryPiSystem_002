/** Trusted structured content. HTML and remote image URLs are never model output fields. */
export interface KnowledgeReport {
  formatVersion: 1;
  topicId: string;
  title: string;
  sections: {
    sourceId: string;
    capturedAt: string;
    title: string;
    category: string;
    summary: string;
    originalText: string;
    pdf?: { assetId: string; filename: string; pageNumber: number; extraction: 'embedded' | 'ocr' | 'unreadable' };
    photos: { imageId: string; description: string }[];
  }[];
}
