import type {
  DueManagementPartItem,
  DueManagementSeibanDetail
} from './due-management-query.service.js';
import { resolveEffectiveDueDisplay, type EffectiveDueDisplaySource } from './due-management-effective-due-display.js';
import { getProcessingTypePriority } from './policies/processing-priority-policy.js';

export type PresentedDueManagementPartItem = DueManagementPartItem & {
  effectiveDueDate: Date | null;
  effectiveDueDateSource: EffectiveDueDisplaySource;
};

export type PresentedDueManagementSeibanDetail = Omit<DueManagementSeibanDetail, 'parts'> & {
  processingTypeDueDates: Array<{ processingType: string; dueDate: Date | null }>;
  parts: PresentedDueManagementPartItem[];
};

export type PartEffectiveDueDate = {
  dueDate: Date | null;
  source: EffectiveDueDisplaySource;
};

/**
 * Decorates the raw due-management detail used by both the existing due
 * screen and the planning-board detail endpoint.  Keeping this here ensures
 * both endpoints expose the same processing buttons and effective-date rule.
 */
export function presentDueManagementSeibanDetail(params: {
  detail: DueManagementSeibanDetail;
  processingDueDateMap: ReadonlyMap<string, Date>;
  partManualDueDateMap?: ReadonlyMap<string, Date | null>;
  partEffectiveDueDateMap?: ReadonlyMap<string, PartEffectiveDueDate>;
}): PresentedDueManagementSeibanDetail {
  const processingTypes = Array.from(new Set(
    params.detail.parts
      .map((part) => part.processingType?.trim() ?? '')
      .filter((processingType) => processingType.length > 0)
  )).sort((left, right) => {
    const leftPriority = getProcessingTypePriority(left);
    const rightPriority = getProcessingTypePriority(right);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.localeCompare(right);
  });
  const processingTypeDueDates = processingTypes.map((processingType) => ({
    processingType,
    dueDate: params.processingDueDateMap.get(processingType) ?? null
  }));

  return {
    ...params.detail,
    processingTypeDueDates,
    parts: params.detail.parts.map((part) => {
      const forcedDue = params.partEffectiveDueDateMap?.get(part.fhincd);
      if (forcedDue !== undefined) {
        return {
          ...part,
          effectiveDueDate: forcedDue.dueDate,
          effectiveDueDateSource: forcedDue.source
        };
      }
      const processingDue = part.processingType == null
        ? params.detail.dueDate
        : params.processingDueDateMap.get(part.processingType) ?? params.detail.dueDate;
      const manualDue = params.partManualDueDateMap?.get(part.fhincd);
      const { displayDueDate, source } = resolveEffectiveDueDisplay({
        manualDue: manualDue !== undefined ? manualDue : processingDue,
        plannedEndDate: part.plannedEndDate
      });
      return {
        ...part,
        effectiveDueDate: displayDueDate,
        effectiveDueDateSource: source
      };
    })
  };
}
