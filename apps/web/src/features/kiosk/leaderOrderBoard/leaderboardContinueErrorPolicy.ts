import { isAxiosError } from 'axios';

/**
 * `leaderboard-board/continue` の失敗を、ユーザー向けの恒久エラー表示に値するかで分類する。
 *
 * - **transient**: 到達性・リバースプロキシ・タイムアウト等。次の shell 再取得フェーズで追補を再試行できる余地がある。
 * - **terminal**: 4xx（契約・認可など）。自動追補では解消しない想定のためユーザーへ明示する。
 */
export type LeaderboardContinueFailureKind = 'transient' | 'terminal';

export function normalizeLeaderboardContinueFailure(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function classifyLeaderboardContinueFailure(error: unknown): LeaderboardContinueFailureKind {
  if (!isAxiosError(error)) {
    return 'terminal';
  }

  const status = error.response?.status;
  if (status == null) {
    // 応答未取得: ネットワーク断・接続拒否・タイムアウト等
    return 'transient';
  }

  // 明示的な再試行候補
  if (status === 408 || status === 429) {
    return 'transient';
  }

  if (status >= 500 && status <= 599) {
    return 'transient';
  }

  if (status >= 400 && status <= 499) {
    return 'terminal';
  }

  return 'terminal';
}
