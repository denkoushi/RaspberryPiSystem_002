import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import { ShelfLayoutEditorControls } from './ShelfLayoutEditorControls';
import { ShelfZero2wAssignmentRail } from './ShelfZero2wAssignmentRail';

import type { MachineMasterDto } from '../../../../api/client';
import type { LayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import type { Zero2wAssignmentFlowGates } from '../flow/zero2wAssignmentFlow';
import type { DraftEntity } from '../model/shelfLayoutTypes';

type Zero2wDevice = {
  id: string;
  name: string;
  shelfCodeRaw: string | null;
};

type Props = {
  layoutGates: LayoutEditorFlowGates;
  zero2wGates: Zero2wAssignmentFlowGates;
  multiMode: boolean;
  gridSize: 3 | 4;
  pendingKind: DraftEntity['entityKind'] | null;
  selectedMachineCd: string;
  machines: MachineMasterDto[];
  layoutSavePending: boolean;
  zero2wDevices: Zero2wDevice[];
  selectedZero2wDeviceId: string;
  selectedZero2wShelf: string;
  zero2wSavePending: boolean;
  onToggleMulti: () => void;
  onGridSizeChange: (size: 3 | 4) => void;
  onClearSelection: () => void;
  onPickKind: (kind: DraftEntity['entityKind']) => void;
  onMachineChange: (cd: string) => void;
  onAssign: () => void;
  onClearCells: () => void;
  onLayoutSave: () => void;
  onSelectZero2wDevice: (deviceId: string, currentShelf: string) => void;
  onZero2wSave: () => void;
};

export function ShelfLayoutEditorShell({
  layoutGates,
  zero2wGates,
  multiMode,
  gridSize,
  pendingKind,
  selectedMachineCd,
  machines,
  layoutSavePending,
  zero2wDevices,
  selectedZero2wDeviceId,
  selectedZero2wShelf,
  zero2wSavePending,
  onToggleMulti,
  onGridSizeChange,
  onClearSelection,
  onPickKind,
  onMachineChange,
  onAssign,
  onClearCells,
  onLayoutSave,
  onSelectZero2wDevice,
  onZero2wSave
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
        onToggleMulti={onToggleMulti}
        onGridSizeChange={onGridSizeChange}
        onClearSelection={onClearSelection}
        onPickKind={onPickKind}
        onMachineChange={onMachineChange}
        onAssign={onAssign}
        onClearCells={onClearCells}
        onSave={onLayoutSave}
      />
      <ShelfZero2wAssignmentRail
        gates={zero2wGates}
        devices={zero2wDevices}
        selectedDeviceId={selectedZero2wDeviceId}
        selectedShelf={selectedZero2wShelf}
        savePending={zero2wSavePending}
        onSelectDevice={onSelectZero2wDevice}
        onSave={onZero2wSave}
      />
    </div>
  );
}
