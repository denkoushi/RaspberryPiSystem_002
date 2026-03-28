import { performance } from 'node:perf_hooks';

import { logger } from '../../../lib/logger.js';

import { normalizePhotoToolDisplayName } from './photo-tool-label-normalize.js';
import { env } from '../../../config/env.js';

import type {
  PendingPhotoLabelRepositoryPort,
  PhotoToolVisionImageSourcePort,
  VisionCompletionPort,
} from './photo-tool-label-ports.js';

export const DEFAULT_PHOTO_TOOL_VISION_USER_PROMPT =
  '画像の中で最も目立つ工具を1つだけ選び、日本語の短い工具名だけを答えてください。説明文や句読点は不要です。';

const log = logger.child({ component: 'photoToolLabeling' });

export type PhotoToolLabelingServiceDeps = {
  repo: PendingPhotoLabelRepositoryPort;
  visionImageSource: PhotoToolVisionImageSourcePort;
  vision: VisionCompletionPort;
  isVisionConfigured: () => boolean;
  /** テスト・差し替え用。未指定時は env + デフォルト文言 */
  getVisionUserPrompt?: () => string;
};

export class PhotoToolLabelingService {
  constructor(private readonly deps: PhotoToolLabelingServiceDeps) {}

  /**
   * スタックした claim を解放し、設定済みなら未処理 Loan を順に処理する。
   */
  async runBatch(params: { batchSize: number; staleBefore: Date }): Promise<void> {
    const resetCount = await this.deps.repo.resetStaleClaims(params.staleBefore);
    if (resetCount > 0) {
      log.info({ resetCount }, 'Photo tool label stale claims reset');
    }

    if (!this.deps.isVisionConfigured()) {
      log.debug('Photo tool label batch skipped: LocalLLM not configured');
      return;
    }

    const pending = await this.deps.repo.listPendingLoans(params.batchSize);
    for (const row of pending) {
      const claimed = await this.deps.repo.tryClaim(row.id);
      if (!claimed) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await this.processClaimedLoan(row.id, row.photoUrl);
    }
  }

  private visionUserPrompt(): string {
    return (
      this.deps.getVisionUserPrompt?.() ??
      env.PHOTO_TOOL_LABEL_USER_PROMPT?.trim() ??
      DEFAULT_PHOTO_TOOL_VISION_USER_PROMPT
    );
  }

  private async processClaimedLoan(loanId: string, photoUrl: string): Promise<void> {
    const started = performance.now();
    let ok = false;
    let responseCharLen = 0;
    try {
      const imageBytes = await this.deps.visionImageSource.readImageBytesForVision(photoUrl);
      const { rawText } = await this.deps.vision.complete({
        userText: this.visionUserPrompt(),
        imageBytes,
        mimeType: 'image/jpeg',
      });
      responseCharLen = rawText.length;
      const label = normalizePhotoToolDisplayName(rawText);
      if (label) {
        await this.deps.repo.completeWithLabel(loanId, label);
        ok = true;
      } else {
        await this.deps.repo.releaseClaim(loanId);
      }
    } catch (err) {
      log.warn({ err, loanId }, 'Photo tool label inference failed');
      await this.deps.repo.releaseClaim(loanId);
    } finally {
      const durationMs = Math.round(performance.now() - started);
      log.info(
        {
          loanId,
          durationMs,
          ok,
          responseCharLen,
        },
        'Photo tool label job finished'
      );
    }
  }
}
