import { getMacroZoneById, type MacroZoneId } from '@raspi-system/shelf-layout-core';
import { useCallback, useEffect, useMemo } from 'react';

import { resolveLayoutEditorConfirmAction } from '../flow/layoutEditorConfirmAction';
import { getLayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import { useShelfZero2wPreset } from '../hooks/useShelfZero2wPreset';
import { useZoneLayoutDraft } from '../hooks/useZoneLayoutDraft';
import {
  collectShelfCodesOnZoneMap,
  findOrphanZero2wDevicesInZone
} from '../zero2wPreset/orphanZero2wDevices';
import { resolveZero2wTargetShelfCodeRaw } from '../zero2wPreset/resolveZero2wTargetShelf';
import { resolveShelfSelectionContext } from '../zero2wPreset/shelfSelectionContext';
import { buildZero2wPiSelectOptions } from '../zero2wPreset/zero2wPiSelectOptions';
import { ZERO2W_PI_UNCHANGED } from '../zero2wPreset/zero2wPiSelectValue';

import { ShelfFactoryMapView } from './ShelfFactoryMapView';
import { ShelfLayoutEditorShell } from './ShelfLayoutEditorShell';
import { ShelfMasterZoneDialogFrame } from './ShelfMasterZoneDialogFrame';

import type { MachineMasterDto } from '../../../../api/client';

type Props = {
  zoneId: MacroZoneId | null;
  isOpen: boolean;
  machines: MachineMasterDto[];
  onClose: () => void;
  onZoneChange: (zoneId: MacroZoneId) => void;
  onMessage: (message: string | null) => void;
};

export function ShelfZoneLayoutDialog({ zoneId, isOpen, machines, onClose, onZoneChange, onMessage }: Props) {
  const draft = useZoneLayoutDraft(isOpen ? zoneId : null);

  const {
    devices: zero2wDevices,
    selectedPi,
    setSelectedPi,
    reset: resetZero2w,
    resetFlowInput,
    syncPiForShelf,
    queuePresetAfterAssign,
    applyPresetForExistingShelf,
    clearPresetForDevice,
    flushPendingPresets,
    piSelectionNeedsApply,
    presetApplyPending,
    clearingDeviceId
  } = useShelfZero2wPreset({ isOpen, onMessage });

  const shelfContext = useMemo(
    () => resolveShelfSelectionContext(draft.selectedCells, draft.draftEntities),
    [draft.selectedCells, draft.draftEntities]
  );

  const selectionIsExistingShelf = shelfContext.kind === 'shelf';
  const pendingShelfAssign = draft.pendingKind === 'SHELF' && draft.selectedCells.length > 0;
  const piSelectionActive = selectedPi !== ZERO2W_PI_UNCHANGED;

  const targetShelfCodeRaw = useMemo(() => {
    if (!draft.zoneQuery.data) {
      return null;
    }
    return resolveZero2wTargetShelfCodeRaw({
      selectedCells: draft.selectedCells,
      draftEntities: draft.draftEntities,
      pendingKind: draft.pendingKind,
      gridSize: draft.gridSize,
      shelfPrefix: draft.zoneQuery.data.shelfPrefix,
      baseNextShelfSlot: draft.zoneQuery.data.nextShelfSlot
    });
  }, [
    draft.selectedCells,
    draft.draftEntities,
    draft.pendingKind,
    draft.gridSize,
    draft.zoneQuery.data
  ]);

  const zero2wPiOptions = useMemo(
    () => buildZero2wPiSelectOptions(zero2wDevices, targetShelfCodeRaw),
    [zero2wDevices, targetShelfCodeRaw]
  );

  const orphanZero2wDevices = useMemo(() => {
    if (!isOpen || !draft.zoneQuery.data) {
      return [];
    }
    const zoneShelfCodes = collectShelfCodesOnZoneMap(draft.draftEntities);
    return findOrphanZero2wDevicesInZone(
      zero2wDevices,
      zoneShelfCodes,
      draft.zoneQuery.data.shelfPrefix
    );
  }, [draft.draftEntities, draft.zoneQuery.data, isOpen, zero2wDevices]);

  const layoutGates = getLayoutEditorFlowGates({
    selectedCount: draft.selectedCells.length,
    pendingKind: draft.pendingKind,
    selectedMachineCd: draft.selectedMachineCd,
    dirty: draft.dirty,
    savePending: draft.savePending,
    multiMode: draft.multiMode,
    piSelectionActive,
    selectionIsExistingShelf,
    pendingShelfAssign,
    zero2wPiSelectionNeedsApply: piSelectionNeedsApply(targetShelfCodeRaw)
  });

  useEffect(() => {
    if (!isOpen) {
      resetZero2w();
    }
  }, [isOpen, resetZero2w]);

  useEffect(() => {
    resetZero2w();
  }, [zoneId, resetZero2w]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (shelfContext.kind === 'shelf') {
      syncPiForShelf(shelfContext.shelfCodeRaw);
      return;
    }
    setSelectedPi(ZERO2W_PI_UNCHANGED);
  }, [isOpen, setSelectedPi, shelfContext, syncPiForShelf]);

  const handlePickKind = useCallback(
    (kind: Parameters<typeof draft.setPendingKind>[0]) => {
      if (kind !== 'SHELF') {
        setSelectedPi(ZERO2W_PI_UNCHANGED);
      }
      draft.setPendingKind(kind);
    },
    [draft, setSelectedPi]
  );

  const handleResetFlow = useCallback(() => {
    draft.handleResetFlowState();
    resetFlowInput();
  }, [draft, resetFlowInput]);

  const handleConfirm = useCallback(() => {
    const action = resolveLayoutEditorConfirmAction(layoutGates);
    if (!action) {
      return;
    }
    if (action === 'save') {
      draft.saveLayout(
        async () => {
          const flushed = await flushPendingPresets();
          if (!flushed) {
            onMessage('レイアウトを保存しました');
          }
          onClose();
        },
        (msg) => onMessage(msg)
      );
      return;
    }
    if (action === 'zero2wPresetApply') {
      if (targetShelfCodeRaw) {
        applyPresetForExistingShelf(targetShelfCodeRaw);
      }
      return;
    }
    const assignedShelfCodeRaw = draft.handleAssign(machines, (msg) => onMessage(msg));
    if (assignedShelfCodeRaw) {
      queuePresetAfterAssign(assignedShelfCodeRaw);
    }
  }, [
    applyPresetForExistingShelf,
    draft,
    flushPendingPresets,
    layoutGates,
    machines,
    onClose,
    onMessage,
    queuePresetAfterAssign,
    targetShelfCodeRaw
  ]);

  const requestClose = () => {
    if (draft.dirty) {
      const ok = window.confirm('未保存の変更があります。閉じて破棄しますか？');
      if (!ok) return;
    }
    onClose();
  };

  if (!zoneId) return null;

  const title = `編集 — ${getMacroZoneById(zoneId).displayName}`;

  return (
    <ShelfMasterZoneDialogFrame
      isOpen={isOpen}
      onClose={requestClose}
      title={title}
      loading={draft.zoneQuery.isLoading}
      map={
        <ShelfFactoryMapView
          zoneId={zoneId}
          gridSize={draft.gridSize}
          draftEntities={draft.draftEntities}
          selectedCells={draft.selectedCells}
          relocateSource={null}
          tab="layout"
          layoutEmphasizeCells={layoutGates.emphasize === 'cells'}
          relocateEmphasize={null}
          relocateCellActionable={() => false}
          relocateCellsDisabled
          onOpenZone={onZoneChange}
          onToggleCell={draft.toggleCell}
        />
      }
      dock={
        <ShelfLayoutEditorShell
          gates={layoutGates}
          multiMode={draft.multiMode}
          gridSize={draft.gridSize}
          pendingKind={draft.pendingKind}
          selectedMachineCd={draft.selectedMachineCd}
          machines={machines}
          layoutSavePending={draft.savePending}
          zero2wPiOptions={zero2wPiOptions}
          selectedPi={selectedPi}
          orphanZero2wDevices={orphanZero2wDevices}
          zero2wPresetApplyPending={presetApplyPending}
          zero2wClearingDeviceId={clearingDeviceId}
          hasCellSelection={draft.selectedCells.length > 0}
          onClearOrphanPreset={clearPresetForDevice}
          onToggleMulti={() => draft.setMultiMode((v) => !v)}
          onGridSizeChange={draft.handleGridSizeChange}
          onClearSelection={draft.handleDeselectOnly}
          onPickKind={handlePickKind}
          onMachineChange={draft.setSelectedMachineCd}
          onPiChange={setSelectedPi}
          onConfirm={handleConfirm}
          onResetFlow={handleResetFlow}
        />
      }
    />
  );
}
