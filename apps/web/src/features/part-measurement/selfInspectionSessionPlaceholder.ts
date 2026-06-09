import type { SelfInspectionSessionDetailDto } from './types';

/** entry 切替用 placeholder。別 sessionId へ遷移したときは前セッションを表示しない。 */
export function resolveSelfInspectionSessionPlaceholderData(
  previousData: SelfInspectionSessionDetailDto | undefined,
  sessionId: string | null | undefined
): SelfInspectionSessionDetailDto | undefined {
  if (!sessionId || !previousData || previousData.id !== sessionId) {
    return undefined;
  }
  return previousData;
}
