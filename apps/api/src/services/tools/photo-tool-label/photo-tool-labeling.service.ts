import { performance } from 'node:perf_hooks';

import { logger } from '../../../lib/logger.js';

import { normalizePhotoToolDisplayName } from './photo-tool-label-normalize.js';
import { env } from '../../../config/env.js';

import type {
  PendingPhotoLabelRepositoryPort,
  PhotoToolVisionImageSourcePort,
  VisionCompletionPort,
} from './photo-tool-label-ports.js';
import type { PhotoToolLabelAssistPort } from './photo-tool-label-assist.port.js';
import { buildShadowAssistedUserPrompt } from './photo-tool-label-prompt-builder.js';
import type { LocalLlmRuntimeControllerPort } from '../../inference/runtime/local-llm-runtime-control.port.js';

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
  /** GOOD 類似によるシャドー補助（本番保存ラベルは変更しない） */
  labelAssist?: PhotoToolLabelAssistPort | null;
  /** true のときのみシャドー推論を実行（埋め込み・フラグの論理は呼び出し側で統一してよい） */
  shadowAssistEnabled?: () => boolean;
  /** on_demand 時: 推論前後に llama-server 起動・停止を挟む（未指定は制御なし） */
  localLlmRuntime?: LocalLlmRuntimeControllerPort | null;
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
    let runtimeHeld = false;
    try {
      if (this.deps.localLlmRuntime && this.deps.isVisionConfigured()) {
        await this.deps.localLlmRuntime.ensureReady('photo_label');
        runtimeHeld = true;
      }
      const imageBytes = await this.deps.visionImageSource.readImageBytesForVision(photoUrl);
      const { rawText } = await this.deps.vision.complete({
        userText: this.visionUserPrompt(),
        imageBytes,
        mimeType: 'image/jpeg',
      });
      responseCharLen = rawText.length;
      const label = normalizePhotoToolDisplayName(rawText);

      await this.maybeRunShadowAssistedInference({
        loanId,
        photoUrl,
        imageBytes,
        currentLabel: label,
      });

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
      if (runtimeHeld && this.deps.localLlmRuntime) {
        await this.deps.localLlmRuntime.release('photo_label').catch((releaseErr) => {
          log.warn({ err: releaseErr, loanId }, 'Photo tool label runtime release failed');
        });
      }
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

  /**
   * 本番ラベル確定前に、条件付きで補助プロンプトの 2 回目 VLM を実行しログのみ残す。
   */
  private async maybeRunShadowAssistedInference(params: {
    loanId: string;
    photoUrl: string;
    imageBytes: Buffer;
    currentLabel: string | null;
  }): Promise<void> {
    if (!this.deps.shadowAssistEnabled?.() || !this.deps.labelAssist) {
      return;
    }
    const { loanId, photoUrl, imageBytes, currentLabel } = params;
    try {
      const decision = await this.deps.labelAssist.evaluateForShadow({
        loanId,
        photoUrl,
        queryJpegBytes: imageBytes,
      });
      if (!decision.shouldAssist) {
        log.debug(
          {
            loanId,
            reason: decision.reason,
            topDistance: decision.topDistance,
            neighborCountAfterFilter: decision.neighborCountAfterFilter,
          },
          'Photo tool label shadow assist skipped'
        );
        return;
      }
      const assistedUserText = buildShadowAssistedUserPrompt(this.visionUserPrompt(), decision.candidateLabels);
      const { rawText: assistedRaw } = await this.deps.vision.complete({
        userText: assistedUserText,
        imageBytes,
        mimeType: 'image/jpeg',
      });
      const assistedLabel = normalizePhotoToolDisplayName(assistedRaw);
      log.info(
        {
          loanId,
          assistTriggered: true,
          reason: decision.reason,
          topDistance: decision.topDistance,
          neighborCountAfterFilter: decision.neighborCountAfterFilter,
          candidateLabels: decision.candidateLabels,
          currentLabel,
          assistedLabel: assistedLabel ?? null,
        },
        'Photo tool label shadow assist inference completed'
      );
    } catch (err) {
      log.warn({ err, loanId }, 'Photo tool label shadow assist failed');
    }
  }
}
