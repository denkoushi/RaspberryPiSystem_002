import type { PhotoToolSimilarityGalleryRepositoryPort } from './photo-tool-similarity-gallery-repository.port.js';
import type {
  PhotoToolLabelActiveAssistGatePort,
  PhotoToolLabelActiveAssistGateResult,
} from './photo-tool-label-active-assist-gate.port.js';

export type GalleryRowCountActiveAssistGateConfig = {
  /** env: PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED を反映 */
  activeEnabled: boolean;
  /** env: PHOTO_TOOL_LABEL_ASSIST_ACTIVE_MIN_GALLERY_ROWS */
  minGalleryRows: number;
};

/**
 * ギャラリー行数によるマイルドゲート。Repository 実装の詳細を隠す。
 */
export class GalleryRowCountActiveAssistGate implements PhotoToolLabelActiveAssistGatePort {
  constructor(
    private readonly gallery: PhotoToolSimilarityGalleryRepositoryPort,
    private readonly config: GalleryRowCountActiveAssistGateConfig
  ) {}

  async evaluate(convergedCanonicalLabel: string): Promise<PhotoToolLabelActiveAssistGateResult> {
    const trimmed = convergedCanonicalLabel.trim();
    if (!trimmed) {
      return { allowed: false, rowCount: 0 };
    }
    const rowCount = await this.gallery.countRowsByCanonicalLabel(trimmed);
    const allowed =
      this.config.activeEnabled && rowCount >= Math.max(1, this.config.minGalleryRows);
    return { allowed, rowCount };
  }
}
