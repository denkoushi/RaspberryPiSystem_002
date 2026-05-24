import { shelfMasterButtonClass, shelfMasterSelectClass, shelfMasterTheme } from '../theme/shelfMasterTheme';

import { ShelfZero2wOrphanPanel } from './ShelfZero2wOrphanPanel';

import type { MachineMasterDto } from '../../../../api/client';
import type { LayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import type { DraftEntity } from '../model/shelfLayoutTypes';
import type { OrphanZero2wDevice } from '../zero2wPreset/orphanZero2wDevices';
import type { Zero2wPiSelectOption } from '../zero2wPreset/zero2wPiSelectOptions';
import type { Zero2wPiSelectValue } from '../zero2wPreset/zero2wPiSelectValue';

const KIND_LABELS: Record<Exclude<DraftEntity['entityKind'], never>, string> = {
  SHELF: '部品置き場',
  MACHINE: '加工機',
  AISLE: '通路',
  UNUSED: '未使用'
};

type Props = {
  gates: LayoutEditorFlowGates;
  multiMode: boolean;
  gridSize: 3 | 4;
  pendingKind: DraftEntity['entityKind'] | null;
  selectedMachineCd: string;
  machines: MachineMasterDto[];
  savePending: boolean;
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
  onSave: () => void;
};

export function ShelfLayoutEditorControls({
  gates,
  multiMode,
  gridSize,
  pendingKind,
  selectedMachineCd,
  machines,
  savePending,
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
  onSave
}: Props) {
  return (
    <div className={shelfMasterTheme.dockLeft}>
      <div className={shelfMasterTheme.ctlRow}>
        <button
          type="button"
          className={shelfMasterButtonClass(multiMode, { enabled: gates.multiMode })}
          disabled={!gates.multiMode}
          onClick={onToggleMulti}
        >
          {multiMode ? '☑ 複数マス' : '☐ 複数マス'}
        </button>
        <select
          className={shelfMasterSelectClass(gates.gridSize, gates.emphasize === 'cells')}
          value={gridSize}
          disabled={!gates.gridSize}
          onChange={(e) => onGridSizeChange(Number(e.target.value) as 3 | 4)}
        >
          <option value={3}>3×3</option>
          <option value={4}>4×4</option>
        </select>
        <button
          type="button"
          className={shelfMasterButtonClass(false, {
            enabled: gates.clearSelection,
            flow: gates.emphasize === 'kinds' && gates.clearSelection
          })}
          disabled={!gates.clearSelection}
          onClick={onClearSelection}
        >
          選択解除
        </button>
      </div>

      <div className={shelfMasterTheme.ctlRow}>
        {(['SHELF', 'MACHINE', 'AISLE', 'UNUSED'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={shelfMasterButtonClass(pendingKind === k, {
              enabled: gates.kindButtons,
              flow: gates.emphasize === 'kinds' && gates.kindButtons
            })}
            disabled={!gates.kindButtons}
            onClick={() => onPickKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {gates.machineSelect ? (
        <select
          className={shelfMasterSelectClass(gates.machineSelect, gates.emphasize === 'machineSelect')}
          value={selectedMachineCd}
          disabled={!gates.machineSelect}
          onChange={(e) => onMachineChange(e.target.value)}
        >
          <option value="">加工機を選択</option>
          {machines.map((m) => (
            <option key={m.resourceCd} value={m.resourceCd}>
              {m.resourceName} ({m.resourceCd})
            </option>
          ))}
        </select>
      ) : null}

      {gates.zero2wPiSelect ? (
        <select
          className={shelfMasterSelectClass(gates.zero2wPiSelect, gates.emphasize === 'zero2wPiSelect')}
          value={selectedPi}
          disabled={!gates.zero2wPiSelect}
          onChange={(e) => onPiChange(e.target.value)}
        >
          {zero2wPiOptions.map((opt) => (
            <option key={opt.value || '__unchanged__'} value={opt.value} disabled={opt.disabled}>
              {opt.subLabel ? `${opt.label}（${opt.subLabel}）` : opt.label}
            </option>
          ))}
        </select>
      ) : null}

      <ShelfZero2wOrphanPanel
        orphans={orphanZero2wDevices}
        clearingDeviceId={zero2wClearingDeviceId}
        presetApplyPending={zero2wPresetApplyPending}
        onClear={onClearOrphanPreset}
      />

      <div className={shelfMasterTheme.ctlRow}>
        <button
          type="button"
          className={shelfMasterButtonClass(true, {
            enabled: gates.assign,
            flow: gates.emphasize === 'assign',
            variant: 'primary'
          })}
          disabled={!gates.assign}
          onClick={onAssign}
        >
          選択マスに割当
        </button>
        {gates.zero2wPresetApply ? (
          <button
            type="button"
            className={shelfMasterButtonClass(true, {
              enabled: gates.zero2wPresetApply,
              flow: gates.emphasize === 'zero2wPresetApply',
              variant: 'primary'
            })}
            disabled={!gates.zero2wPresetApply || zero2wPresetApplyPending}
            onClick={onZero2wPresetApply}
          >
            担当を反映
          </button>
        ) : null}
        <button
          type="button"
          className={shelfMasterButtonClass(false, {
            enabled: gates.clearCells,
            variant: 'danger'
          })}
          disabled={!gates.clearCells}
          onClick={onClearCells}
        >
          選択マスを解除
        </button>
        <button
          type="button"
          className={shelfMasterButtonClass(true, {
            enabled: gates.save,
            flow: gates.emphasize === 'save',
            variant: 'primary'
          })}
          disabled={!gates.save || savePending}
          onClick={onSave}
        >
          レイアウト保存
        </button>
      </div>
    </div>
  );
}
