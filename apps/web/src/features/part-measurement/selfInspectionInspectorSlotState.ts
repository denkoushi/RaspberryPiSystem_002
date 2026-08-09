import type { SelfInspectionInspectorSlotStateDto } from './types';

export type SelfInspectionInspectorSlotBadge = '未' | '可' | '中' | '済';

export type SelfInspectionInspectorSlotPresentation = {
  badge: SelfInspectionInspectorSlotBadge;
  label: string;
  tone: 'muted' | 'info' | 'warning' | 'success';
  selectable: boolean;
  ariaLabel: string;
};

const FALLBACK_STATE: SelfInspectionInspectorSlotStateDto = {
  entryIndex: -1,
  operatorState: 'missing',
  inspectorState: 'not_started'
};

export function inspectorSlotStateForEntry(
  states: readonly SelfInspectionInspectorSlotStateDto[] | undefined,
  entryIndex: number
): SelfInspectionInspectorSlotStateDto {
  return states?.find((state) => state.entryIndex === entryIndex) ?? {
    ...FALLBACK_STATE,
    entryIndex
  };
}

export function presentSelfInspectionInspectorSlotState(
  state: SelfInspectionInspectorSlotStateDto,
  entryLabel = `${state.entryIndex + 1}件目`
): SelfInspectionInspectorSlotPresentation {
  if (state.operatorState !== 'confirmed') {
    return {
      badge: '未',
      label: `${entryLabel}：作業者未確定。作業者が「入力を保存」すると検査できます`,
      tone: 'muted',
      selectable: false,
      ariaLabel: `${entryLabel}：作業者未確定。作業者が「入力を保存」すると検査できます`
    };
  }

  if (state.inspectorState === 'complete') {
    return {
      badge: '済',
      label: `${entryLabel}：検査員測定完了`,
      tone: 'success',
      selectable: true,
      ariaLabel: `${entryLabel}：検査員測定完了。再表示できます`
    };
  }

  if (state.inspectorState === 'in_progress') {
    return {
      badge: '中',
      label: `${entryLabel}：検査員測定中`,
      tone: 'warning',
      selectable: true,
      ariaLabel: `${entryLabel}：検査員測定中。選択できます`
    };
  }

  return {
    badge: '可',
    label: `${entryLabel}：検査員測定可能`,
    tone: 'info',
    selectable: true,
    ariaLabel: `${entryLabel}：作業者確定済み。検査員測定を開始できます`
  };
}

export function resolveFirstInspectorUsableEntryIndex(
  states: readonly SelfInspectionInspectorSlotStateDto[] | undefined
): number | null {
  const usable = (states ?? []).filter((state) => state.operatorState === 'confirmed');
  const firstByPriority = (inspectorState: SelfInspectionInspectorSlotStateDto['inspectorState']) =>
    usable.find((state) => state.inspectorState === inspectorState)?.entryIndex ?? null;
  return firstByPriority('not_started') ?? firstByPriority('in_progress') ?? firstByPriority('complete');
}

