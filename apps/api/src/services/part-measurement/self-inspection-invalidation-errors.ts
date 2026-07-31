import { ApiError } from '../../lib/errors.js';

export const SELF_INSPECTION_INVALIDATION_CONFLICT =
  'SELF_INSPECTION_ITEM_INVALIDATION_CONFLICT';

export function selfInspectionInvalidationConflict(message: string): ApiError {
  return new ApiError(
    409,
    message,
    undefined,
    SELF_INSPECTION_INVALIDATION_CONFLICT
  );
}

export function assertSelfInspectionSessionActive(session: {
  invalidatedAt: Date | null;
}): void {
  if (session.invalidatedAt) {
    throw selfInspectionInvalidationConflict(
      'この自主検査アイテムは削除済みのため操作できません'
    );
  }
}
