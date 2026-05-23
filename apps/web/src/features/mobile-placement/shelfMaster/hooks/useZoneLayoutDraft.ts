import { useEffect, useMemo, useState } from 'react';

import { applyLayoutAssignment, clearAssignmentsOnCells } from '../model/layoutDraftActions';
import { isLayoutDraftDirty, snapshotFromZone } from '../model/layoutDraftDirty';
import { useSaveShelfLayoutZone, useShelfLayoutZone } from '../useShelfMasterQueries';

import type { MachineMasterDto } from '../../../../api/client';
import type { DraftEntity, LayoutDraftSnapshot } from '../model/shelfLayoutTypes';
import type { MacroZoneId } from '@raspi-system/shelf-layout-core';

function entitiesFromZone(entities: DraftEntity[]): DraftEntity[] {
  return entities.map((e) => ({
    ...e,
    cellIndices: [...e.cellIndices]
  }));
}

export function useZoneLayoutDraft(zoneId: MacroZoneId | null) {
  const zoneQuery = useShelfLayoutZone(zoneId);
  const saveMutation = useSaveShelfLayoutZone(zoneId ?? 'nw');

  const [gridSize, setGridSize] = useState<3 | 4>(3);
  const [draftEntities, setDraftEntities] = useState<DraftEntity[]>([]);
  const [baseline, setBaseline] = useState<LayoutDraftSnapshot | null>(null);
  const [selectedCells, setSelectedCells] = useState<number[]>([]);
  const [multiMode, setMultiMode] = useState(false);
  const [pendingKind, setPendingKind] = useState<DraftEntity['entityKind'] | null>(null);
  const [selectedMachineCd, setSelectedMachineCd] = useState('');

  useEffect(() => {
    if (zoneQuery.data) {
      const entities = entitiesFromZone(
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
      );
      setGridSize(zoneQuery.data.gridSize);
      setDraftEntities(entities);
      setBaseline(snapshotFromZone(zoneQuery.data.gridSize, entities));
      setSelectedCells([]);
      setPendingKind(null);
      setSelectedMachineCd('');
    }
  }, [zoneQuery.data]);

  const dirty = useMemo(
    () => isLayoutDraftDirty(baseline, { gridSize, entities: draftEntities }),
    [baseline, gridSize, draftEntities]
  );

  const toggleCell = (cells: number[]) => {
    if (cells.length === 1) {
      const idx = cells[0]!;
      setSelectedCells((prev) => {
        if (!multiMode) return prev.includes(idx) ? [] : [idx];
        if (prev.includes(idx)) return prev.filter((c) => c !== idx);
        return [...prev, idx];
      });
    }
  };

  const handleAssign = (machines: MachineMasterDto[], onError: (msg: string) => void) => {
    if (!zoneQuery.data || !pendingKind) return;
    const result = applyLayoutAssignment({
      draftEntities,
      selectedCells,
      pendingKind,
      machines,
      selectedMachineCd,
      gridSize,
      shelfPrefix: zoneQuery.data.shelfPrefix,
      baseNextShelfSlot: zoneQuery.data.nextShelfSlot
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setDraftEntities(result.entities);
    setSelectedCells([]);
    setPendingKind(null);
    setSelectedMachineCd('');
  };

  const handleGridSizeChange = (size: 3 | 4) => {
    setGridSize(size);
    setSelectedCells([]);
    setPendingKind(null);
    setSelectedMachineCd('');
    if (!zoneQuery.data) return;
    const filtered = draftEntities
      .map((e) => ({ ...e, cellIndices: e.cellIndices.filter((i) => i < size * size) }))
      .filter((e) => e.cellIndices.length > 0);
    setDraftEntities(filtered);
  };

  const saveLayout = (onSuccess: () => void, onError: (msg: string) => void) => {
    if (!zoneId || !zoneQuery.data || !dirty) return;
    saveMutation.mutate(
      {
        gridSize,
        expectedUpdatedAt: zoneQuery.data.updatedAt,
        entities: draftEntities.map((e) => ({
          entityKind: e.entityKind,
          cellIndices: e.cellIndices,
          resourceCd: e.resourceCd,
          resourceName: e.resourceName,
          aisleLabel: e.aisleLabel,
          shelfCodeRaw: e.shelfCodeRaw
        }))
      },
      {
        onSuccess: () => {
          void zoneQuery.refetch();
          onSuccess();
        },
        onError: (e: unknown) => onError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    );
  };

  return {
    zoneQuery,
    gridSize,
    draftEntities,
    selectedCells,
    multiMode,
    pendingKind,
    selectedMachineCd,
    dirty,
    savePending: saveMutation.isPending,
    setMultiMode,
    setPendingKind,
    setSelectedMachineCd,
    toggleCell,
    handleAssign,
    handleGridSizeChange,
    handleDeselectOnly: () => {
      setSelectedCells([]);
      setPendingKind(null);
      setSelectedMachineCd('');
    },
    handleClearCells: () => {
      setDraftEntities(clearAssignmentsOnCells(draftEntities, selectedCells));
      setSelectedCells([]);
      setPendingKind(null);
    },
    saveLayout
  };
}
