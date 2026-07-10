import type { SelfInspectionEntryPersistenceStatus } from '@prisma/client';

export const SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED =
  'CONFIRMED' satisfies SelfInspectionEntryPersistenceStatus;
export const SELF_INSPECTION_ENTRY_PERSISTENCE_DRAFT =
  'DRAFT' satisfies SelfInspectionEntryPersistenceStatus;

export const confirmedWhere = {
  persistenceStatus: SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED
} as const;

/** Prisma `_count.select.entries` 用（CONFIRMED のみ） */
export const confirmedEntriesCountSelect = {
  entries: { where: confirmedWhere }
} as const;

export function isConfirmed(
  status: SelfInspectionEntryPersistenceStatus | string | null | undefined
): boolean {
  return status === SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED;
}

export function countConfirmedEntries(
  entries: Array<{ persistenceStatus?: SelfInspectionEntryPersistenceStatus | string | null }>
): number {
  return entries.filter((entry) => isConfirmed(entry.persistenceStatus ?? SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED))
    .length;
}

export function serializePersistenceStatus(
  status: SelfInspectionEntryPersistenceStatus | string | null | undefined
): 'draft' | 'confirmed' {
  return isConfirmed(status ?? SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED) ? 'confirmed' : 'draft';
}
