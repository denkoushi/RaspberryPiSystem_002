import { getMacroZoneById, type MacroZoneId } from '@raspi-system/shelf-layout-core';
import { useEffect, useMemo, useState } from 'react';


import { Dialog } from '../../../../components/ui/Dialog';
import { getRelocateFlowGates } from '../flow/relocateFlow';
import { entityAtCell } from '../model/shelfLayoutGrid';
import { useRelocateShelf, useShelfLayoutZone } from '../useShelfMasterQueries';

import { ShelfFactoryMapView } from './ShelfFactoryMapView';
import { ShelfRelocateDock } from './ShelfRelocateDock';

import type { DraftEntity } from '../model/shelfLayoutTypes';

type Props = {
  zoneId: MacroZoneId | null;
  isOpen: boolean;
  onClose: () => void;
  onZoneChange: (id: MacroZoneId) => void;
  onMessage: (message: string | null) => void;
};

function entitiesFromZone(entities: DraftEntity[]): DraftEntity[] {
  return entities.map((e) => ({
    ...e,
    cellIndices: [...e.cellIndices]
  }));
}

export function ShelfZoneRelocateDialog({ zoneId, isOpen, onClose, onZoneChange, onMessage }: Props) {
  const zoneQuery = useShelfLayoutZone(isOpen ? zoneId : null);
  const relocateMutation = useRelocateShelf();
  const [draftEntities, setDraftEntities] = useState<DraftEntity[]>([]);
  const [gridSize, setGridSize] = useState<3 | 4>(3);
  const [relocateSource, setRelocateSource] = useState<string | null>(null);

  useEffect(() => {
    if (zoneQuery.data) {
      setDraftEntities(
        entitiesFromZone(
          zoneQuery.data.entities.map((e) => ({
            id: e.id,
            entityKind: e.entityKind,
            cellIndices: [...e.cellIndices],
            resourceCd: e.resourceCd,
            resourceName: e.resourceName,
            shelfCodeRaw: e.shelfCodeRaw,
            displayLabel: e.displayLabel,
            aisleLabel: e.aisleLabel
          }))
        )
      );
      setGridSize(zoneQuery.data.gridSize);
      setRelocateSource(null);
    }
  }, [zoneQuery.data]);

  const relocateGates = getRelocateFlowGates({
    relocateSource,
    relocatePending: relocateMutation.isPending
  });

  const relocateSourceLabel = useMemo(() => {
    if (!relocateSource) return null;
    const entity = draftEntities.find((e) => e.shelfCodeRaw === relocateSource);
    return entity?.displayLabel ?? relocateSource;
  }, [relocateSource, draftEntities]);

  const relocateStatusText =
    relocateSource && relocateGates.emphasize === 'target'
      ? `移動元: ${relocateSourceLabel} — 移動先をタップ`
      : relocateGates.statusText;

  const toggleCell = (cells: number[]) => {
    if (relocateGates.cellsDisabled) return;
    const entity = entityAtCell(draftEntities, cells[0] ?? -1);
    if (!relocateGates.isCellActionable(entity)) return;
    if (!relocateSource) {
      setRelocateSource(entity!.shelfCodeRaw!);
      onMessage(`移動元: ${entity!.displayLabel ?? entity!.shelfCodeRaw}`);
      return;
    }
    if (relocateSource === entity!.shelfCodeRaw) {
      setRelocateSource(null);
      onMessage(null);
      return;
    }
    relocateMutation.mutate(
      { sourceShelfCodeRaw: relocateSource, targetShelfCodeRaw: entity!.shelfCodeRaw! },
      {
        onSuccess: () => {
          setRelocateSource(null);
          onMessage('再割当が完了しました');
          void zoneQuery.refetch();
        },
        onError: (e: unknown) => onMessage(e instanceof Error ? e.message : '再割当に失敗しました')
      }
    );
  };

  if (!zoneId) return null;

  const title = `再割当 — ${getMacroZoneById(zoneId).displayName}`;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} size="full" overlayZIndex={80}>
      <div className="flex max-h-[min(85vh,900px)] min-h-0 flex-col gap-3">
        {zoneQuery.isLoading ? (
          <p className="text-center text-sm text-slate-400">読み込み中…</p>
        ) : (
          <>
            <ShelfFactoryMapView
              zoneId={zoneId}
              gridSize={gridSize}
              draftEntities={draftEntities}
              selectedCells={[]}
              relocateSource={relocateSource}
              tab="relocate"
              layoutEmphasizeCells={false}
              relocateEmphasize={relocateGates.emphasize}
              relocateCellActionable={relocateGates.isCellActionable}
              relocateCellsDisabled={relocateGates.cellsDisabled}
              onOpenZone={onZoneChange}
              onToggleCell={toggleCell}
            />
            <ShelfRelocateDock statusText={relocateStatusText} />
          </>
        )}
      </div>
    </Dialog>
  );
}
