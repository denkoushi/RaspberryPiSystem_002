import type { MachineMasterDto } from '../../../../api/client';
import type { LayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import type { DraftEntity } from '../model/shelfLayoutTypes';
import type { OrphanZero2wDevice } from '../zero2wPreset/orphanZero2wDevices';
import type { Zero2wPiSelectOption } from '../zero2wPreset/zero2wPiSelectOptions';
import type { Zero2wPiSelectValue } from '../zero2wPreset/zero2wPiSelectValue';

export type LayoutEditorDockCallbacks = {
  onToggleMulti: () => void;
  onGridSizeChange: (size: 3 | 4) => void;
  onClearSelection: () => void;
  onPickKind: (kind: DraftEntity['entityKind']) => void;
  onMachineChange: (cd: string) => void;
  onPiChange: (value: Zero2wPiSelectValue) => void;
  onConfirm: () => void;
  onResetFlow: () => void;
  onClearOrphanPreset: (deviceId: string) => void;
};

export type LayoutEditorDockViewModel = {
  gates: LayoutEditorFlowGates;
  multiMode: boolean;
  gridSize: 3 | 4;
  pendingKind: DraftEntity['entityKind'] | null;
  selectedMachineCd: string;
  machines: MachineMasterDto[];
  layoutSavePending: boolean;
  zero2wPresetApplyPending: boolean;
  zero2wPiOptions: Zero2wPiSelectOption[];
  selectedPi: Zero2wPiSelectValue;
  orphanZero2wDevices: OrphanZero2wDevice[];
  zero2wClearingDeviceId: string | null;
  hasCellSelection: boolean;
};
