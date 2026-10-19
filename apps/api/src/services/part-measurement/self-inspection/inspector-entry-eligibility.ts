import { ApiError } from '../../../lib/errors.js';
import { isConfirmed } from './entry-persistence-status.js';

export const SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED =
  'SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED';

export function assertOperatorEntryConfirmedForInspector(entry: {
  entryIndex: number;
  persistenceStatus?: string | null;
} | null): asserts entry is { entryIndex: number; persistenceStatus?: string | null } {
  if (entry && isConfirmed(entry.persistenceStatus)) return;
  const entryLabel = entry ? `入力件${entry.entryIndex + 1}` : '対象の入力件';
  throw new ApiError(
    409,
    `${entryLabel}は作業者が未確定です。作業者が「入力を保存」してから再試行してください`,
    undefined,
    SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED
  );
}
