import type { SelfInspectionSessionSummaryDto } from './types';

export function resolveSelfInspectionRequiredEntryCount(
  session: Pick<SelfInspectionSessionSummaryDto, 'expectedEntryCount' | 'requiredEntryCount'>
): number {
  return session.requiredEntryCount ?? session.expectedEntryCount;
}
