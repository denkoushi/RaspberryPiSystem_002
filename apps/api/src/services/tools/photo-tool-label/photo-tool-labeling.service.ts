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
import type { PhotoToolLabelActiveAssistGatePort } from './photo-tool-label-active-assist-gate.port.js';
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
  /** GOOD 類似によるシャドー補助・アクティブ保存ゲートの評価 */
  labelAssist?: PhotoToolLabelAssistPort | null;
  /** true のときのみシャドー推論を実行（埋め込み・フラグの論理は呼び出し側で統一してよい） */
  shadowAssistEnabled?: () => boolean;
  /** true のときギャラリー件数ゲート通過後に 2 回目結果を本番保存しうる */
  activeAssistEnabled?: () => boolean;
  /** 収束 canonical のギャラリー行数によるアクティブ保存可否 */
  activeAssistGate?: PhotoToolLabelActiveAssistGatePort | null;
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
      const firstPassLabel = normalizePhotoToolDisplayName(rawText);

      let persistLabel = firstPassLabel;
      if (this.assistPipelineWanted()) {
        const assist = await this.runLabelAssistPipeline({
          loanId,
          photoUrl,
          imageBytes,
          firstPassLabel,
        });
        if (firstPassLabel && assist.activePersistEligible && assist.assistedLabel) {
          persistLabel = assist.assistedLabel;
        }
      }

      if (persistLabel) {
        await this.deps.repo.completeWithLabel(loanId, persistLabel);
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

  private assistPipelineWanted(): boolean {
    return Boolean(
      this.deps.labelAssist &&
        (this.deps.shadowAssistEnabled?.() || this.deps.activeAssistEnabled?.())
    );
  }

  /**
   * GOOD 類似が成立するとき、シャドー・アクティブに応じて 2 回目 VLM を実行しログする。
   * アクティブかつギャラリー件数ゲート通過時のみ assisted を本番保存候補として返す。
   */
  private async runLabelAssistPipeline(params: {
    loanId: string;
    photoUrl: string;
    imageBytes: Buffer;
    firstPassLabel: string | null;
  }): Promise<{
    assistedLabel: string | null;
    activePersistEligible: boolean;
  }> {
    const empty = {
      assistedLabel: null as string | null,
      activePersistEligible: false,
    };
    if (!this.deps.labelAssist) {
      return empty;
    }

    const { loanId, photoUrl, imageBytes, firstPassLabel } = params;
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
        return empty;
      }

      const convergedLabel = decision.convergedCanonicalLabel?.trim() ?? '';
      const shadowOn = this.deps.shadowAssistEnabled?.() ?? false;
      const activeOn = this.deps.activeAssistEnabled?.() ?? false;

      let gateResult = { allowed: false, rowCount: 0 };
      if (convergedLabel && this.deps.activeAssistGate && activeOn) {
        gateResult = await this.deps.activeAssistGate.evaluate(convergedLabel);
      }
      const runSecondVision = shadowOn || (activeOn && gateResult.allowed);

      if (!runSecondVision) {
        log.debug(
          {
            loanId,
            reason: 'second_vision_suppressed',
            shadowOn,
            activeOn,
            gateAllowed: gateResult.allowed,
            galleryRowCount: gateResult.rowCount,
          },
          'Photo tool label assist second vision skipped'
        );
        return {
          assistedLabel: null,
          activePersistEligible: activeOn && gateResult.allowed,
        };
      }

      const assistedUserText = buildShadowAssistedUserPrompt(this.visionUserPrompt(), decision.candidateLabels);
      const { rawText: assistedRaw } = await this.deps.vision.complete({
        userText: assistedUserText,
        imageBytes,
        mimeType: 'image/jpeg',
      });
      const assistedLabel = normalizePhotoToolDisplayName(assistedRaw);
      const activePersistEligible = activeOn && gateResult.allowed;
      const activePersistApplied = Boolean(activePersistEligible && assistedLabel && firstPassLabel);

      log.info(
        {
          loanId,
          assistTriggered: true,
          reason: decision.reason,
          topDistance: decision.topDistance,
          neighborCountAfterFilter: decision.neighborCountAfterFilter,
          candidateLabels: decision.candidateLabels,
          currentLabel: firstPassLabel,
          assistedLabel: assistedLabel ?? null,
          galleryRowCount: gateResult.rowCount,
          activePersistEligible,
          activePersistApplied,
        },
        'Photo tool label shadow assist inference completed'
      );

      return { assistedLabel, activePersistEligible };
    } catch (err) {
      log.warn({ err, loanId }, 'Photo tool label shadow assist failed');
      return empty;
    }
  }
}
