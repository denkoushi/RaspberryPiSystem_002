import { env } from '../../../config/env.js';

export type PhotoToolEmbeddingHealth = {
  state: 'ok' | 'failed' | 'not_observed' | 'disabled';
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorBrief: string | null;
};

type FailureKind = 'connection' | 'timeout' | 'response' | 'invalid';
const failureMessages: Record<FailureKind, string> = {
  connection: '写真の処理先に接続できませんでした',
  timeout: '写真の処理が時間内に終わりませんでした',
  response: '写真の処理先でエラーが起きました',
  invalid: '写真の処理結果を読み取れませんでした',
};
let health: PhotoToolEmbeddingHealth = {
  state: 'not_observed', lastSuccessAt: null, lastFailureAt: null, lastErrorBrief: null,
};

export function recordPhotoToolEmbeddingSuccess(): void {
  health = { ...health, state: 'ok', lastSuccessAt: new Date().toISOString() };
}

export function recordPhotoToolEmbeddingFailure(kind: FailureKind): void {
  health = {
    ...health, state: 'failed', lastFailureAt: new Date().toISOString(), lastErrorBrief: failureMessages[kind],
  };
}

export function readPhotoToolEmbeddingHealth(): PhotoToolEmbeddingHealth {
  return { ...health, state: env.PHOTO_TOOL_EMBEDDING_ENABLED ? health.state : 'disabled' };
}
