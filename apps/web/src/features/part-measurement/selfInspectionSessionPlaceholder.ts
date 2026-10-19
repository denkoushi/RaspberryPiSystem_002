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

/**
 * 未保存 entry へ切り替えるときの initialData。
 * API は未保存 entry に focusedEntry: null を返し、他の項目は entryIndex に依存しないため、
 * キャッシュ済みの同一セッションから即座に組み立てて入力ロックを避ける（取得は裏で続く）。
 */
export function resolveSelfInspectionUnsavedEntryInitialData(
  cached: ReadonlyArray<{ data: SelfInspectionSessionDetailDto | undefined; updatedAt: number }>,
  sessionId: string | null | undefined,
  entryIndex: number | undefined
): { data: SelfInspectionSessionDetailDto; updatedAt: number } | undefined {
  if (!sessionId || entryIndex == null) return undefined;
  let latest: { data: SelfInspectionSessionDetailDto; updatedAt: number } | undefined;
  for (const candidate of cached) {
    if (candidate.data?.id !== sessionId) continue;
    if (!latest || candidate.updatedAt > latest.updatedAt) {
      latest = { data: candidate.data, updatedAt: candidate.updatedAt };
    }
  }
  if (!latest) return undefined;
  if (latest.data.entries.some((entry) => entry.entryIndex === entryIndex)) return undefined;
  return { data: { ...latest.data, focusedEntry: null }, updatedAt: latest.updatedAt };
}

/**
 * initialData で仮表示中（サーバー取得も setQueryData もまだ無い）かどうか。
 * 他端末の保存を見落とさないよう、この間はサーバーへの書き込みを止める。
 */
export function isSelfInspectionSessionSeedPending(
  state: { data: unknown; dataUpdateCount: number } | undefined
): boolean {
  return state !== undefined && state.data !== undefined && state.dataUpdateCount === 0;
}

/**
 * 仮表示した entry の記録を更新し、サーバー値へ置き換えるべきかを返す。
 * entry ごとに記録するため、確認前に別 entry へ移っても戻ったときに照合される。
 */
export function consumeSelfInspectionSeededEntry(
  seededEntryKeys: Set<string>,
  input: { entryKey: string; isSeedPending: boolean; isSavedOnServer: boolean }
): 'rebind_to_server' | 'none' {
  if (input.isSeedPending) {
    seededEntryKeys.add(input.entryKey);
    return 'none';
  }
  if (!seededEntryKeys.delete(input.entryKey)) return 'none';
  return input.isSavedOnServer ? 'rebind_to_server' : 'none';
}
