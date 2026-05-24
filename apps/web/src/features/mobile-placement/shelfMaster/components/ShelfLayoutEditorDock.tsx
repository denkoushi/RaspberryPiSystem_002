import clsx from 'clsx';

import {
  isLayoutEditorConfirmEnabled,
  isLayoutEditorConfirmPending,
  resolveLayoutEditorConfirmAction
} from '../flow/layoutEditorConfirmAction';
import { shelfMasterButtonClass, shelfMasterSelectClass, shelfMasterTheme } from '../theme/shelfMasterTheme';

import { ShelfZero2wOrphanPanel } from './ShelfZero2wOrphanPanel';

import type { LayoutEditorDockCallbacks, LayoutEditorDockViewModel } from './layoutEditorDockTypes';
import type { DraftEntity } from '../model/shelfLayoutTypes';

const KIND_LABELS: Record<Exclude<DraftEntity['entityKind'], never>, string> = {
  SHELF: '部品置き場',
  MACHINE: '加工機',
  AISLE: '通路',
  UNUSED: '未使用'
};

type Props = LayoutEditorDockViewModel & LayoutEditorDockCallbacks;

export function ShelfLayoutEditorDock({
  gates,
  multiMode,
  gridSize,
  pendingKind,
  selectedMachineCd,
  machines,
  layoutSavePending,
  zero2wPresetApplyPending,
  zero2wPiOptions,
  selectedPi,
  orphanZero2wDevices,
  zero2wClearingDeviceId,
  hasCellSelection,
  onToggleMulti,
  onGridSizeChange,
  onClearSelection,
  onPickKind,
  onMachineChange,
  onPiChange,
  onConfirm,
  onResetFlow,
  onClearOrphanPreset
}: Props) {
  const emphasize = gates.emphasize;
  const confirmAction = resolveLayoutEditorConfirmAction(gates);
  const confirmPending = isLayoutEditorConfirmPending({
    action: confirmAction,
    savePending: layoutSavePending,
    zero2wPresetApplyPending
  });
  const confirmEnabled = isLayoutEditorConfirmEnabled(gates) && !confirmPending;
  const confirmFlow =
    emphasize === 'assign' || emphasize === 'zero2wPresetApply' || emphasize === 'save';
  const showDetail = gates.machineSelect || gates.zero2wPiSelect;

  const railClass = clsx(
    shelfMasterTheme.dockRail,
    showDetail
      ? '[grid-template-columns:auto_auto_auto_auto]'
      : '[grid-template-columns:auto_auto_auto]'
  );

  return (
    <div className={shelfMasterTheme.dockInner}>
      <div className={railClass}>
        <div
          className={clsx(
            shelfMasterTheme.dockZone,
            emphasize === 'cells' && shelfMasterTheme.dockZoneFlow
          )}
        >
          <button
            type="button"
            className={shelfMasterButtonClass(multiMode, { enabled: gates.multiMode })}
            disabled={!gates.multiMode}
            onClick={onToggleMulti}
          >
            {multiMode ? '☑ 複数区画選択' : '☐ 複数区画選択'}
          </button>
          <select
            className={shelfMasterSelectClass(gates.gridSize, emphasize === 'cells')}
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
              flow: emphasize === 'kinds' && gates.clearSelection
            })}
            disabled={!gates.clearSelection}
            onClick={onClearSelection}
          >
            選択解除
          </button>
        </div>

        <div
          className={clsx(
            shelfMasterTheme.dockZone,
            shelfMasterTheme.dockZoneKinds,
            emphasize === 'kinds' && shelfMasterTheme.dockZoneFlow
          )}
        >
          <p className={shelfMasterTheme.dockZoneTitle}>区画用途を割当</p>
          <div className={shelfMasterTheme.kindsGrid}>
            {(['SHELF', 'MACHINE', 'AISLE', 'UNUSED'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={clsx(
                  shelfMasterButtonClass(pendingKind === k && hasCellSelection, {
                    enabled: gates.kindButtons,
                    flow: gates.emphasize === 'kinds' && gates.kindButtons
                  }),
                  'w-full min-w-0 justify-center truncate px-1 text-[0.68rem]'
                )}
                disabled={!gates.kindButtons}
                onClick={() => onPickKind(k)}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        {showDetail ? (
          <div
            className={clsx(
              shelfMasterTheme.dockZone,
              shelfMasterTheme.dockZoneDetail,
              (emphasize === 'machineSelect' ||
                emphasize === 'zero2wPiSelect' ||
                emphasize === 'zero2wPresetApply') &&
                shelfMasterTheme.dockZoneFlow
            )}
          >
            {gates.machineSelect ? (
              <select
                className={clsx(
                  shelfMasterSelectClass(gates.machineSelect, emphasize === 'machineSelect'),
                  'w-full'
                )}
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
                className={clsx(
                  shelfMasterSelectClass(
                    gates.zero2wPiSelect,
                    emphasize === 'zero2wPiSelect' || emphasize === 'zero2wPresetApply'
                  ),
                  'w-full'
                )}
                value={selectedPi}
                disabled={!gates.zero2wPiSelect || zero2wPresetApplyPending}
                onChange={(e) => onPiChange(e.target.value as typeof selectedPi)}
              >
                {zero2wPiOptions.map((opt) => (
                  <option
                    key={opt.value || '__unchanged__'}
                    value={opt.value}
                    disabled={opt.disabled}
                  >
                    {opt.subLabel ? `${opt.label}（${opt.subLabel}）` : opt.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}

        <div
          className={clsx(
            shelfMasterTheme.dockZone,
            shelfMasterTheme.dockZoneCommit,
            confirmFlow && shelfMasterTheme.dockZoneFlow
          )}
        >
          <div className={shelfMasterTheme.commitMainRow}>
            <button
              type="button"
              className={clsx(
                confirmFlow && confirmEnabled
                  ? shelfMasterTheme.commitConfirmBtn
                  : shelfMasterButtonClass(false, {
                      enabled: confirmEnabled,
                      flow: confirmFlow,
                      variant: 'primary'
                    }),
                !confirmEnabled && shelfMasterTheme.ctlOff
              )}
              disabled={!confirmEnabled}
              onClick={onConfirm}
            >
              確定
            </button>
            <button
              type="button"
              className={shelfMasterButtonClass(false, {
                enabled: gates.resetFlow
              })}
              disabled={!gates.resetFlow}
              onClick={onResetFlow}
            >
              リセット
            </button>
          </div>
        </div>
      </div>

      <div className={shelfMasterTheme.dockBottom}>
        <ShelfZero2wOrphanPanel
          orphans={orphanZero2wDevices}
          clearingDeviceId={zero2wClearingDeviceId}
          presetApplyPending={zero2wPresetApplyPending}
          onClear={onClearOrphanPreset}
        />
      </div>
    </div>
  );
}
