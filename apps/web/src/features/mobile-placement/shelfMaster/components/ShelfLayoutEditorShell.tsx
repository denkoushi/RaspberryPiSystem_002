import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import { ShelfLayoutEditorControls } from './ShelfLayoutEditorControls';

import type { MachineMasterDto } from '../../../../api/client';
import type { LayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import type { DraftEntity } from '../model/shelfLayoutTypes';
import type { OrphanZero2wDevice } from '../zero2wPreset/orphanZero2wDevices';
import type { Zero2wPiSelectOption } from '../zero2wPreset/zero2wPiSelectOptions';
import type { Zero2wPiSelectValue } from '../zero2wPreset/zero2wPiSelectValue';

type Props = {
  layoutGates: LayoutEditorFlowGates;
  multiMode: boolean;
  gridSize: 3 | 4;
  pendingKind: DraftEntity['entityKind'] | null;
  selectedMachineCd: string;
  machines: MachineMasterDto[];
  layoutSavePending: boolean;
  zero2wPiOptions: Zero2wPiSelectOption[];
  selectedPi: Zero2wPiSelectValue;
  orphanZero2wDevices: OrphanZero2wDevice[];
  zero2wPresetApplyPending: boolean;
  zero2wClearingDeviceId: string | null;
  onClearOrphanPreset: (deviceId: string) => void;
  onToggleMulti: () => void;
  onGridSizeChange: (size: 3 | 4) => void;
  onClearSelection: () => void;
  onPickKind: (kind: DraftEntity['entityKind']) => void;
  onMachineChange: (cd: string) => void;
  onPiChange: (value: Zero2wPiSelectValue) => void;
  onAssign: () => void;
  onClearCells: () => void;
  onZero2wPresetApply: () => void;
  onLayoutSave: () => void;
};

export function ShelfLayoutEditorShell({
  layoutGates,
  multiMode,
  gridSize,
  pendingKind,
  selectedMachineCd,
  machines,
  layoutSavePending,
  zero2wPiOptions,
  selectedPi,
  orphanZero2wDevices,
  zero2wPresetApplyPending,
  zero2wClearingDeviceId,
  onClearOrphanPreset,
  onToggleMulti,
  onGridSizeChange,
  onClearSelection,
  onPickKind,
  onMachineChange,
  onPiChange,
  onAssign,
  onClearCells,
  onZero2wPresetApply,
  onLayoutSave
}: Props) {
  return (
    <div className={shelfMasterTheme.dockShell}>
      <ShelfLayoutEditorControls
        gates={layoutGates}
        multiMode={multiMode}
        gridSize={gridSize}
        pendingKind={pendingKind}
        selectedMachineCd={selectedMachineCd}
        machines={machines}
        savePending={layoutSavePending}
        zero2wPiOptions={zero2wPiOptions}
        selectedPi={selectedPi}
        orphanZero2wDevices={orphanZero2wDevices}
        zero2wPresetApplyPending={zero2wPresetApplyPending}
        zero2wClearingDeviceId={zero2wClearingDeviceId}
        onClearOrphanPreset={onClearOrphanPreset}
        onToggleMulti={onToggleMulti}
        onGridSizeChange={onGridSizeChange}
        onClearSelection={onClearSelection}
        onPickKind={onPickKind}
        onMachineChange={onMachineChange}
        onPiChange={onPiChange}
        onAssign={onAssign}
        onClearCells={onClearCells}
        onZero2wPresetApply={onZero2wPresetApply}
        onSave={onLayoutSave}
      />
    </div>
  );
}
