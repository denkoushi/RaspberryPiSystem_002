import { logger } from '../../../lib/logger.js';

import type { InferenceUseCase } from '../types/inference-usecase.js';

const log = logger.child({ component: 'inference' });

export type InferenceCallOutcome = {
  useCase: InferenceUseCase;
  providerId: string;
  model: string;
  latencyMs: number;
  result: 'ok' | 'failure';
  errorReason?: string;
  /** 推論入力のおおよそのバイト長（本文はログに出さない） */
  inputSize: number;
  /** 出力テキスト長 */
  outputSize: number;
};

export function emitInferenceCallOutcome(outcome: InferenceCallOutcome): void {
  log.info(outcome, 'Inference call completed');
}
