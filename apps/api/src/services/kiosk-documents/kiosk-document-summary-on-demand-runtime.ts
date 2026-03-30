import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';

/** 要領書要約のためオンデマンドで llama-server を確保すべきか（設定・推論解決の組み合わせ） */
export function kioskDocumentSummaryNeedsOnDemandRuntime(): boolean {
  return (
    env.LOCAL_LLM_RUNTIME_MODE === 'on_demand' &&
    env.KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED &&
    getInferenceRuntime().isDocumentSummaryInferenceConfigured()
  );
}

/**
 * 深夜バッチ・手動再処理など、要領書 OCR/要約パイプライン実行前後で
 * document_summary 用のランタイム参照を取る（ensure 失敗時は従来どおり続行）。
 */
export async function withDocumentSummaryOnDemandRuntime<T>(fn: () => Promise<T>): Promise<T> {
  if (!kioskDocumentSummaryNeedsOnDemandRuntime()) {
    return fn();
  }

  const runtime = getLocalLlmRuntimeController();
  let runtimeHeld = false;
  try {
    await runtime.ensureReady('document_summary');
    runtimeHeld = true;
  } catch (error) {
    logger.warn(
      { err: error },
      '[KioskDocument] on-demand LLM runtime ensure failed; processing continues without pre-started server'
    );
  }

  try {
    return await fn();
  } finally {
    if (runtimeHeld) {
      await runtime.release('document_summary').catch((releaseErr) => {
        logger.warn({ err: releaseErr }, '[KioskDocument] on-demand LLM runtime release failed');
      });
    }
  }
}
