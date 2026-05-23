import { shelfMasterButtonClass, shelfMasterSelectClass, shelfMasterTheme } from '../theme/shelfMasterTheme';

import type { MachineMasterDto } from '../../../../api/client';
import type { LayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import type { DraftEntity } from '../model/shelfLayoutTypes';

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
  onToggleMulti: () => void;
  onGridSizeChange: (size: 3 | 4) => void;
  onClearSelection: () => void;
  onPickKind: (kind: DraftEntity['entityKind']) => void;
  onMachineChange: (cd: string) => void;
  onAssign: () => void;
  onClearCells: () => void;
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
  onToggleMulti,
  onGridSizeChange,
  onClearSelection,
  onPickKind,
  onMachineChange,
  onAssign,
  onClearCells,
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
