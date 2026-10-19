import { listRequiredEntrySlots, type SelfInspectionTemplateConfig } from '../self-inspection-config.js';
import type { SelfInspectionInspectorMeasurementState } from './shared.js';

export type InspectorOperatorSlotState = 'missing' | 'draft' | 'confirmed';
export type InspectorSlotMeasurementState = 'not_started' | 'in_progress' | 'complete';

export type InspectorSlotState = {
  entryIndex: number;
  operatorState: InspectorOperatorSlotState;
  inspectorState: InspectorSlotMeasurementState;
};

export type InspectorSlotOperatorSource = {
  entryIndex: number;
  persistenceStatus?: string | null;
};

export type InspectorSlotMeasurementSource = {
  entryIndex: number;
  values: Array<{
    templateItemId: string;
    inspectorValue: unknown | null;
    inspectorJudgementResult: string | null;
  }>;
};

export type InspectorEntryValueCompletionSource = InspectorSlotMeasurementSource;

function operatorStateForEntry(
  entry: InspectorSlotOperatorSource | undefined
): InspectorOperatorSlotState {
  if (!entry) return 'missing';
  return entry.persistenceStatus === 'CONFIRMED' ? 'confirmed' : 'draft';
}

function inspectorStateForEntry(
  entry: InspectorSlotMeasurementSource | undefined,
  requiredItemIds: string[]
): InspectorSlotMeasurementState {
  if (!entry) return 'not_started';
  const valuesByItemId = new Map(entry.values.map((value) => [value.templateItemId, value]));
  const hasMissingValue = requiredItemIds.some((itemId) => {
    const value = valuesByItemId.get(itemId);
    return value?.inspectorValue == null && value?.inspectorJudgementResult == null;
  });
  return hasMissingValue ? 'in_progress' : 'complete';
}

export function buildInspectorSlotStates(input: {
  template: SelfInspectionTemplateConfig;
  plannedQuantity: number;
  itemIds: string[];
  operatorEntries?: InspectorSlotOperatorSource[];
  inspectorEntries?: InspectorSlotMeasurementSource[];
}): InspectorSlotState[] {
  const operatorEntriesByIndex = new Map(
    (input.operatorEntries ?? []).map((entry) => [entry.entryIndex, entry])
  );
  const inspectorEntriesByIndex = new Map(
    (input.inspectorEntries ?? []).map((entry) => [entry.entryIndex, entry])
  );
  return listRequiredEntrySlots(input.template, input.plannedQuantity).map((slot) => ({
    entryIndex: slot.entryIndex,
    operatorState: operatorStateForEntry(operatorEntriesByIndex.get(slot.entryIndex)),
    inspectorState: inspectorStateForEntry(
      inspectorEntriesByIndex.get(slot.entryIndex),
      input.itemIds
    )
  }));
}

export function buildInspectorMeasurementCompletion(input: {
  inspectorRemeasurementRequiredAt?: Date | null;
  recordApproval?: unknown | null;
  completedAt?: Date | null;
  template: SelfInspectionTemplateConfig & { itemIds?: string[] };
  plannedQuantity: number;
  operatorEntries?: InspectorSlotOperatorSource[];
  inspectorEntries?: InspectorSlotMeasurementSource[];
}): {
  state: SelfInspectionInspectorMeasurementState;
  requiredEntryCount: number;
  completedRequiredEntryCount: number;
  missingRequiredEntryCount: number;
  incompleteValueEntryCount: number;
  slotStates: InspectorSlotState[];
} {
  const requiredEntryCount = listRequiredEntrySlots(input.template, input.plannedQuantity).length;
  if (!input.inspectorRemeasurementRequiredAt || input.recordApproval || input.completedAt) {
    return {
      state: 'not_required',
      requiredEntryCount,
      completedRequiredEntryCount: 0,
      missingRequiredEntryCount: 0,
      incompleteValueEntryCount: 0,
      slotStates: buildInspectorSlotStates({
        template: input.template,
        plannedQuantity: input.plannedQuantity,
        itemIds: input.template.itemIds ?? [],
        operatorEntries: input.operatorEntries,
        inspectorEntries: input.inspectorEntries
      })
    };
  }

  const slotStates = buildInspectorSlotStates({
    template: input.template,
    plannedQuantity: input.plannedQuantity,
    itemIds: input.template.itemIds ?? [],
    operatorEntries: input.operatorEntries,
    inspectorEntries: input.inspectorEntries
  });
  let completedRequiredEntryCount = 0;
  let missingRequiredEntryCount = 0;
  let incompleteValueEntryCount = 0;

  for (const slot of slotStates) {
    if (slot.operatorState !== 'confirmed' || slot.inspectorState === 'not_started') {
      missingRequiredEntryCount += 1;
      continue;
    }
    completedRequiredEntryCount += 1;
    if (slot.inspectorState === 'in_progress') {
      incompleteValueEntryCount += 1;
    }
  }

  const state =
    missingRequiredEntryCount === 0 &&
    incompleteValueEntryCount === 0 &&
    requiredEntryCount > 0
      ? 'complete'
      : completedRequiredEntryCount > 0
        ? 'in_progress'
        : 'pending';

  return {
    state,
    requiredEntryCount,
    completedRequiredEntryCount,
    missingRequiredEntryCount,
    incompleteValueEntryCount,
    slotStates
  };
}
