import { env } from '../../../config/env.js';

import type { PhotoToolImageEmbeddingPort } from './photo-tool-image-embedding.port.js';
import type { PhotoToolSimilarityGalleryRepositoryPort } from './photo-tool-similarity-gallery-repository.port.js';
import type { PhotoToolLabelAssistDecision, PhotoToolLabelAssistPort } from './photo-tool-label-assist.port.js';
import { PHOTO_TOOL_DEFAULT_CANONICAL_LABEL } from './photo-tool-label.constants.js';

/**
 * GOOD ギャラリー近傍を厳しめに絞り、ラベルが収束するときだけ VLM 補助対象とする。
 */
export class PhotoToolLabelAssistService implements PhotoToolLabelAssistPort {
  constructor(
    private readonly embedding: PhotoToolImageEmbeddingPort | null,
    private readonly gallery: PhotoToolSimilarityGalleryRepositoryPort
  ) {}

  async evaluateForShadow(input: {
    loanId: string;
    photoUrl: string;
    queryJpegBytes: Buffer;
  }): Promise<PhotoToolLabelAssistDecision> {
    const empty = (reason: string): PhotoToolLabelAssistDecision => ({
      shouldAssist: false,
      candidateLabels: [],
      reason,
      topDistance: null,
      neighborCountAfterFilter: 0,
    });

    if (!env.PHOTO_TOOL_EMBEDDING_ENABLED || !this.embedding) {
      return empty('embedding_disabled');
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embedding.embedJpeg(input.queryJpegBytes);
    } catch {
      return empty('embed_failed');
    }

    const fetchLimit = env.PHOTO_TOOL_LABEL_ASSIST_QUERY_NEIGHBOR_LIMIT;

    let neighbors: Awaited<ReturnType<PhotoToolSimilarityGalleryRepositoryPort['findNearestNeighbors']>>;
    try {
      neighbors = await this.gallery.findNearestNeighbors({
        queryEmbedding,
        excludeLoanId: input.loanId,
        limit: fetchLimit,
      });
    } catch {
      return empty('gallery_query_failed');
    }

    const maxDist = env.PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE;
    const filtered = neighbors.filter((n) => {
      if (n.distance > maxDist) {
        return false;
      }
      const label = n.canonicalLabel?.trim() ?? '';
      if (!label || label === PHOTO_TOOL_DEFAULT_CANONICAL_LABEL) {
        return false;
      }
      return true;
    });

    if (filtered.length < env.PHOTO_TOOL_LABEL_ASSIST_MIN_NEIGHBORS) {
      return {
        shouldAssist: false,
        candidateLabels: [],
        reason: 'too_few_neighbors',
        topDistance: filtered[0]?.distance ?? null,
        neighborCountAfterFilter: filtered.length,
      };
    }

    const k = env.PHOTO_TOOL_LABEL_ASSIST_CONVERGENCE_TOP_K;
    const topSlice = filtered.slice(0, k);
    const first = topSlice[0].canonicalLabel.trim();
    const converged = topSlice.every((n) => n.canonicalLabel.trim() === first);

    if (!converged) {
      return {
        shouldAssist: false,
        candidateLabels: [],
        reason: 'labels_not_converged',
        topDistance: filtered[0].distance,
        neighborCountAfterFilter: filtered.length,
      };
    }

    const promptLabelCap = env.PHOTO_TOOL_LABEL_ASSIST_PROMPT_MAX_LABELS;
    const sameLabelNeighbors = filtered.filter((n) => n.canonicalLabel.trim() === first);
    const forPrompt = sameLabelNeighbors.slice(0, promptLabelCap).map((n) => n.canonicalLabel.trim());
    const candidateLabels = [...new Set(forPrompt)];

    return {
      shouldAssist: true,
      candidateLabels,
      reason: 'converged_neighbors',
      topDistance: filtered[0].distance,
      neighborCountAfterFilter: filtered.length,
    };
  }
}
