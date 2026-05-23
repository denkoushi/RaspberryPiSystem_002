import { getMacroZoneById, type MacroZoneId } from '@raspi-system/shelf-layout-core';

import { Dialog } from '../../../../components/ui/Dialog';
import { getLayoutEditorFlowGates } from '../flow/layoutEditorFlow';
import { useZoneLayoutDraft } from '../hooks/useZoneLayoutDraft';

import { ShelfFactoryMapView } from './ShelfFactoryMapView';
import { ShelfLayoutEditorDock } from './ShelfLayoutEditorDock';

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

  const layoutGates = getLayoutEditorFlowGates({
    selectedCount: draft.selectedCells.length,
    pendingKind: draft.pendingKind,
    selectedMachineCd: draft.selectedMachineCd,
    dirty: draft.dirty,
    savePending: draft.savePending
  });

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
    <Dialog isOpen={isOpen} onClose={requestClose} title={title} size="full" overlayZIndex={80}>
      <div className="flex max-h-[min(85vh,900px)] min-h-0 flex-col gap-3">
        {draft.zoneQuery.isLoading ? (
          <p className="text-center text-sm text-slate-400">読み込み中…</p>
        ) : (
          <>
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
            <ShelfLayoutEditorDock
              gates={layoutGates}
              multiMode={draft.multiMode}
              gridSize={draft.gridSize}
              pendingKind={draft.pendingKind}
              selectedMachineCd={draft.selectedMachineCd}
              machines={machines}
              savePending={draft.savePending}
              onToggleMulti={() => draft.setMultiMode((v) => !v)}
              onGridSizeChange={draft.handleGridSizeChange}
              onClearSelection={draft.handleDeselectOnly}
              onPickKind={draft.setPendingKind}
              onMachineChange={draft.setSelectedMachineCd}
              onAssign={() => draft.handleAssign(machines, (msg) => onMessage(msg))}
              onClearCells={draft.handleClearCells}
              onSave={() =>
                draft.saveLayout(
                  () => {
                    onMessage('レイアウトを保存しました');
                    onClose();
                  },
                  (msg) => onMessage(msg)
                )
              }
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
