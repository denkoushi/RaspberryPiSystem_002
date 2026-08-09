
import {
  inspectorSlotStateForEntry,
  presentSelfInspectionInspectorSlotState
} from './selfInspectionInspectorSlotState';
import { SelfInspectionKioskButton } from './SelfInspectionKioskButton';

import type { SelfInspectionInspectorSlotStateDto } from './types';
import type { ReactNode } from 'react';

type EntrySlot = {
  entryIndex: number;
  entrySlotLabel: string;
  entrySlotKind: string;
};

type Props = {
  slots: readonly EntrySlot[];
  selectedEntryIndex: number;
  isInspectorMode: boolean;
  sessionEmployeeGateReady: boolean;
  inspectorSlotStates?: readonly SelfInspectionInspectorSlotStateDto[];
  onSelect: (entryIndex: number) => void;
  onRefresh?: () => void;
  onPointerDownCapture?: () => void;
  autosaveBadge?: ReactNode;
  headerRight?: ReactNode;
  selectedSlotNotice?: string | null;
};

export function SelfInspectionEntrySlotSelector({
  slots,
  selectedEntryIndex,
  isInspectorMode,
  sessionEmployeeGateReady,
  inspectorSlotStates,
  onSelect,
  onRefresh,
  onPointerDownCapture,
  autosaveBadge,
  headerRight,
  selectedSlotNotice
}: Props) {
  return (
    <div className="shrink-0 rounded border border-white/15 bg-slate-800/70 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <p className="shrink-0 text-sm font-semibold text-white/80">入力件</p>
          {autosaveBadge}
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          {isInspectorMode ? (
            <SelfInspectionKioskButton type="button" size="compact" onClick={onRefresh}>
              状況更新
            </SelfInspectionKioskButton>
          ) : null}
        </div>
      </div>
      {isInspectorMode ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/70" aria-label="個体状態の凡例">
          <span>未：作業者未確定</span>
          <span>可：測定可能</span>
          <span>中：測定中</span>
          <span>済：測定完了</span>
        </div>
      ) : null}
      {selectedSlotNotice ? (
        <p className="mt-1 text-xs leading-relaxed text-amber-100" data-testid="self-inspection-selected-slot-status">
          {selectedSlotNotice}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-1" data-self-inspection-entry-slots>
        {slots.map((slot) => {
          const isSelected = slot.entryIndex === selectedEntryIndex;
          const state = inspectorSlotStateForEntry(inspectorSlotStates, slot.entryIndex);
          const presentation = isInspectorMode
            ? presentSelfInspectionInspectorSlotState(state, slot.entrySlotLabel)
            : null;
          const disabled = !sessionEmployeeGateReady || Boolean(presentation && !presentation.selectable);
          return (
            <SelfInspectionKioskButton
              key={`${slot.entrySlotKind}-${slot.entryIndex}`}
              type="button"
              size="entryDense"
              pressed={isSelected}
              disabled={disabled}
              aria-label={
                presentation?.ariaLabel ??
                (isSelected ? `${slot.entrySlotLabel}（選択中）` : slot.entrySlotLabel)
              }
              title={presentation?.label}
              tone={presentation?.tone === 'success' ? 'success' : presentation?.tone === 'muted' ? 'inactive' : 'default'}
              onPointerDownCapture={onPointerDownCapture}
              onPointerDown={onPointerDownCapture}
              onClick={() => onSelect(slot.entryIndex)}
            >
              {presentation ? `${presentation.badge} ${slot.entrySlotLabel}` : slot.entrySlotLabel}
            </SelfInspectionKioskButton>
          );
        })}
      </div>
    </div>
  );
}
