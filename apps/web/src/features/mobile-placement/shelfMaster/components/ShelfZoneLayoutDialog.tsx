import { getMacroZoneById, type MacroZoneId } from '@raspi-system/shelf-layout-core';
import { useCallback, useEffect } from 'react';

import { getLayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import { useZero2wAssignmentState } from '../hooks/useZero2wAssignmentState';
import { useZoneLayoutDraft } from '../hooks/useZoneLayoutDraft';
import { entityAtCell } from '../model/shelfLayoutGrid';

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

  const layoutCellsSelected = draft.selectedCells.length > 0;

  const {
    devices: zero2wDevices,
    selectedDeviceId: selectedZero2wDeviceId,
    selectedShelf: selectedZero2wShelf,
    gates: zero2wGates,
    selectDevice: selectZero2wDevice,
    selectShelfFromMap,
    reset: resetZero2w,
    save: saveZero2w,
    savePending: zero2wSavePending
  } = useZero2wAssignmentState({
    isOpen,
    layoutCellsSelected,
    onMessage
  });

  const zero2wActive = selectedZero2wDeviceId.length > 0;

  const layoutGates = getLayoutEditorFlowGates({
    selectedCount: draft.selectedCells.length,
    pendingKind: draft.pendingKind,
    selectedMachineCd: draft.selectedMachineCd,
    dirty: draft.dirty,
    savePending: draft.savePending,
    zero2wDeviceSelected: zero2wActive
  });

  useEffect(() => {
    if (!isOpen) {
      resetZero2w();
    }
  }, [isOpen, resetZero2w]);

  useEffect(() => {
    resetZero2w();
  }, [zoneId, resetZero2w]);

  const handleToggleCell = useCallback(
    (cells: number[]) => {
      if (zero2wGates.mapShelfPick) {
        const cell = cells[0];
        if (cell == null) return;
        const entity = entityAtCell(draft.draftEntities, cell);
        if (entity?.entityKind === 'SHELF' && entity.shelfCodeRaw) {
          selectShelfFromMap(entity.shelfCodeRaw);
        }
        return;
      }
      if (zero2wActive) return;
      draft.toggleCell(cells);
    },
    [draft, zero2wGates.mapShelfPick, selectShelfFromMap, zero2wActive]
  );

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
          layoutCellsBlocked={zero2wActive}
          zero2wMapShelfPick={zero2wGates.mapShelfPick}
          zero2wPickedShelfCode={selectedZero2wShelf || null}
          relocateEmphasize={null}
          relocateCellActionable={() => false}
          relocateCellsDisabled
          onOpenZone={onZoneChange}
          onToggleCell={handleToggleCell}
        />
      }
      dock={
        <ShelfLayoutEditorShell
          layoutGates={layoutGates}
          zero2wGates={zero2wGates}
          multiMode={draft.multiMode}
          gridSize={draft.gridSize}
          pendingKind={draft.pendingKind}
          selectedMachineCd={draft.selectedMachineCd}
          machines={machines}
          layoutSavePending={draft.savePending}
          zero2wDevices={zero2wDevices}
          selectedZero2wDeviceId={selectedZero2wDeviceId}
          selectedZero2wShelf={selectedZero2wShelf}
          zero2wSavePending={zero2wSavePending}
          onToggleMulti={() => draft.setMultiMode((v) => !v)}
          onGridSizeChange={draft.handleGridSizeChange}
          onClearSelection={draft.handleDeselectOnly}
          onPickKind={draft.setPendingKind}
          onMachineChange={draft.setSelectedMachineCd}
          onAssign={() => draft.handleAssign(machines, (msg) => onMessage(msg))}
          onClearCells={draft.handleClearCells}
          onLayoutSave={() =>
            draft.saveLayout(
              () => {
                onMessage('レイアウトを保存しました');
                onClose();
              },
              (msg) => onMessage(msg)
            )
          }
          onSelectZero2wDevice={selectZero2wDevice}
          onZero2wSave={saveZero2w}
        />
      }
    />
  );
}
