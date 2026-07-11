import type { SelfInspectionEntryPersistenceStatus } from '@prisma/client';

import { isConfirmed } from './entry-persistence-status.js';

export type DraftUpsertExistingDecision = 'allow' | 'noop_keep_confirmed';

/**
 * CONFIRMED 行への draft upsert は降格させない（autosave 再入で WIP が消えるのを防ぐ）。
 * 呼び出し側は noop のとき DB を更新せず現行 entry を返す。
 */
export function resolveDraftUpsertExistingDecision(
  persistenceStatus: SelfInspectionEntryPersistenceStatus | string | null | undefined
): DraftUpsertExistingDecision {
  if (isConfirmed(persistenceStatus)) {
    return 'noop_keep_confirmed';
  }
  return 'allow';
}
