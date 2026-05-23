import { MACRO_ZONE_CATALOG, getMacroZoneById, type MacroZoneId } from '@raspi-system/shelf-layout-core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { mpKioskTheme } from '../ui/mobilePlacementKioskTheme';

import { ShelfFactoryMapView } from './components/ShelfFactoryMapView';
import { ShelfLayoutEditorDock } from './components/ShelfLayoutEditorDock';
import { ShelfRelocateDock } from './components/ShelfRelocateDock';
import { ShelfZero2wPanel } from './components/ShelfZero2wPanel';
import { getLayoutEditorFlowGates } from './flow/layoutEditorFlow';
import { getRelocateFlowGates } from './flow/relocateFlow';
import { getZero2wAssignmentFlowGates } from './flow/zero2wAssignmentFlow';
import { applyLayoutAssignment, clearAssignmentsOnCells } from './model/layoutDraftActions';
import { isLayoutDraftDirty, snapshotFromZone } from './model/layoutDraftDirty';
import { entityAtCell } from './model/shelfLayoutGrid';
import {
  useAssignZero2wPreset,
  useClientCapabilities,
  useHaizenTargetDevicesForShelfMaster,
  useMachineMasters,
  useRelocateShelf,
  useSaveShelfLayoutZone,
  useShelfLayoutSummary,
  useShelfLayoutZone
} from './useShelfMasterQueries';

import type { DraftEntity, LayoutDraftSnapshot } from './model/shelfLayoutTypes';


type UiTab = 'layout' | 'relocate' | 'zero2w';

const ZONE_COLORS = ['#f59e0b', '#7c3aed', '#dc2626', '#16a34a', '#6b7280', '#78350f', '#ea580c', '#2563eb', '#ec4899'];

function entitiesFromZone(entities: DraftEntity[]): DraftEntity[] {
  return entities.map((e) => ({
    ...e,
    cellIndices: [...e.cellIndices]
  }));
}

export function ShelfMasterPageContent() {
  const navigate = useNavigate();
  const capsQuery = useClientCapabilities();
  const summaryQuery = useShelfLayoutSummary();
  const [zoneId, setZoneId] = useState<MacroZoneId | null>(null);
  const zoneQuery = useShelfLayoutZone(zoneId);
  const machinesQuery = useMachineMasters();
  const saveMutation = useSaveShelfLayoutZone(zoneId ?? 'nw');
  const relocateMutation = useRelocateShelf();
  const zero2wQuery = useHaizenTargetDevicesForShelfMaster();
  const assignZero2w = useAssignZero2wPreset();

  const canEditLayout = capsQuery.data?.shelfLayoutEditEnabled === true;
  const [tab, setTab] = useState<UiTab>('relocate');
  const [gridSize, setGridSize] = useState<3 | 4>(3);
  const [draftEntities, setDraftEntities] = useState<DraftEntity[]>([]);
  const [baseline, setBaseline] = useState<LayoutDraftSnapshot | null>(null);
  const [selectedCells, setSelectedCells] = useState<number[]>([]);
  const [multiMode, setMultiMode] = useState(false);
  const [pendingKind, setPendingKind] = useState<DraftEntity['entityKind'] | null>(null);
  const [selectedMachineCd, setSelectedMachineCd] = useState('');
  const [relocateSource, setRelocateSource] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedZero2wDeviceId, setSelectedZero2wDeviceId] = useState('');
  const [selectedZero2wShelf, setSelectedZero2wShelf] = useState('');

  useEffect(() => {
    if (zoneQuery.data) {
      const entities = entitiesFromZone(zoneQuery.data.entities);
      setGridSize(zoneQuery.data.gridSize);
      setDraftEntities(entities);
      setBaseline(snapshotFromZone(zoneQuery.data.gridSize, entities));
      setSelectedCells([]);
      setPendingKind(null);
      setSelectedMachineCd('');
      setRelocateSource(null);
    }
  }, [zoneQuery.data]);

  useEffect(() => {
    if (canEditLayout) {
      setTab('layout');
    }
  }, [canEditLayout]);

  const summaryById = useMemo(() => {
    const map = new Map<string, { shelfCount: number; machineCount: number }>();
    for (const z of summaryQuery.data?.zones ?? []) {
      map.set(z.macroZoneId, { shelfCount: z.shelfCount, machineCount: z.machineCount });
    }
    return map;
  }, [summaryQuery.data?.zones]);

  const machines = machinesQuery.data?.machines ?? [];
  const zero2wDevices = zero2wQuery.data?.devices ?? [];
  const shelfEntities = draftEntities.filter((e) => e.entityKind === 'SHELF' && e.shelfCodeRaw);

  const dirty = useMemo(
    () => isLayoutDraftDirty(baseline, { gridSize, entities: draftEntities }),
    [baseline, gridSize, draftEntities]
  );

  const layoutGates = getLayoutEditorFlowGates({
    selectedCount: selectedCells.length,
    pendingKind,
    selectedMachineCd,
    dirty,
    savePending: saveMutation.isPending
  });

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

  const zero2wGates = getZero2wAssignmentFlowGates({
    selectedDeviceId: selectedZero2wDeviceId,
    selectedShelf: selectedZero2wShelf,
    savePending: assignZero2w.isPending
  });

  const selectedZero2wDevice = zero2wDevices.find((d) => d.id === selectedZero2wDeviceId) ?? null;

  const onOpenZone = (id: MacroZoneId) => {
    setZoneId(id);
    setMessage(null);
  };

  const onBackFactory = () => {
    setZoneId(null);
    setSelectedCells([]);
    setRelocateSource(null);
    setPendingKind(null);
    setMessage(null);
  };

  const toggleCell = (cells: number[]) => {
    if (tab === 'relocate') {
      if (relocateGates.cellsDisabled) return;
      const entity = entityAtCell(draftEntities, cells[0] ?? -1);
      if (!relocateGates.isCellActionable(entity)) return;
      if (!relocateSource) {
        setRelocateSource(entity!.shelfCodeRaw!);
        setMessage(`移動元: ${entity!.displayLabel ?? entity!.shelfCodeRaw}`);
        return;
      }
      if (relocateSource === entity!.shelfCodeRaw) {
        setRelocateSource(null);
        setMessage(null);
        return;
      }
      relocateMutation.mutate(
        { sourceShelfCodeRaw: relocateSource, targetShelfCodeRaw: entity!.shelfCodeRaw! },
        {
          onSuccess: () => {
            setRelocateSource(null);
            setMessage('再割当が完了しました');
            void zoneQuery.refetch();
          },
          onError: (e: unknown) => setMessage(e instanceof Error ? e.message : '再割当に失敗しました')
        }
      );
      return;
    }
    if (tab !== 'layout' || !canEditLayout) return;
    if (cells.length === 1) {
      const idx = cells[0]!;
      setSelectedCells((prev) => {
        if (!multiMode) return prev.includes(idx) ? [] : [idx];
        if (prev.includes(idx)) return prev.filter((c) => c !== idx);
        return [...prev, idx];
      });
    }
  };

  const handleAssign = () => {
    if (!zoneQuery.data || !canEditLayout) return;
    const result = applyLayoutAssignment({
      draftEntities,
      selectedCells,
      pendingKind: pendingKind!,
      machines,
      selectedMachineCd,
      gridSize,
      shelfPrefix: zoneQuery.data.shelfPrefix,
      baseNextShelfSlot: zoneQuery.data.nextShelfSlot
    });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setDraftEntities(result.entities);
    setSelectedCells([]);
    setPendingKind(null);
    setSelectedMachineCd('');
    setMessage(null);
  };

  const handleDeselectOnly = () => {
    setSelectedCells([]);
    setPendingKind(null);
    setSelectedMachineCd('');
  };

  const handleGridSizeChange = (size: 3 | 4) => {
    setGridSize(size);
    setSelectedCells([]);
    setPendingKind(null);
    setSelectedMachineCd('');
    setRelocateSource(null);
    setMessage(null);
    if (!zoneQuery.data) {
      return;
    }
    const filtered = draftEntities
      .map((e) => ({ ...e, cellIndices: e.cellIndices.filter((i) => i < size * size) }))
      .filter((e) => e.cellIndices.length > 0);
    setDraftEntities(filtered);
  };

  const handleClearCells = () => {
    setDraftEntities(clearAssignmentsOnCells(draftEntities, selectedCells));
    setSelectedCells([]);
    setPendingKind(null);
  };

  const saveLayout = () => {
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
          setMessage('レイアウトを保存しました');
          void zoneQuery.refetch();
        },
        onError: (e: unknown) => setMessage(e instanceof Error ? e.message : '保存に失敗しました')
      }
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-950 text-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-3 py-2">
        {zoneId ? (
          <button type="button" className={mpKioskTheme.partSearchButton} onClick={onBackFactory}>
            ← 全体図
          </button>
        ) : (
          <button type="button" className={mpKioskTheme.partSearchButton} onClick={() => navigate('/kiosk/mobile-placement')}>
            戻る
          </button>
        )}
        <h1 className="flex-1 text-sm font-bold">{zoneId ? getMacroZoneById(zoneId).displayName : '棚マスタ（現場全体図）'}</h1>
        <div className="flex gap-1">
          {canEditLayout ? (
            <button
              type="button"
              className={tab === 'layout' ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton}
              onClick={() => {
                setTab('layout');
                setRelocateSource(null);
                setMessage(null);
              }}
            >
              レイアウト
            </button>
          ) : null}
          <button
            type="button"
            className={tab === 'relocate' ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton}
            onClick={() => {
              setTab('relocate');
              setSelectedCells([]);
              setPendingKind(null);
              setMessage(null);
            }}
          >
            再割当
          </button>
          <button
            type="button"
            className={tab === 'zero2w' ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton}
            onClick={() => {
              setTab('zero2w');
              setRelocateSource(null);
              setSelectedCells([]);
              setMessage(null);
            }}
          >
            Zero2W
          </button>
        </div>
      </div>

      {message ? <div className="bg-emerald-950 px-3 py-2 text-xs text-emerald-200">{message}</div> : null}

      {!zoneId ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <div className="grid max-w-xl grid-cols-3 gap-2 aspect-square w-full">
            {MACRO_ZONE_CATALOG.map((z, i) => {
              const meta = summaryById.get(z.id);
              return (
                <button
                  key={z.id}
                  type="button"
                  className="flex flex-col items-center justify-center rounded-xl border-2 border-white/20 p-2 text-center font-bold"
                  style={{ background: `color-mix(in srgb, ${ZONE_COLORS[i % ZONE_COLORS.length]} 35%, #111)` }}
                  onClick={() => onOpenZone(z.id)}
                >
                  <span className="text-sm">{z.displayName}</span>
                  <span className="mt-1 text-[10px] opacity-80">
                    棚{meta?.shelfCount ?? 0} · 機{meta?.machineCount ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-400">↑ 北 · ← 西 … 東 → · ↓ 南</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          {tab === 'zero2w' ? (
            <ShelfZero2wPanel
              gates={zero2wGates}
              devices={zero2wDevices}
              shelfEntities={shelfEntities}
              selectedDeviceId={selectedZero2wDeviceId}
              selectedShelf={selectedZero2wShelf}
              savePending={assignZero2w.isPending}
              onDeviceChange={(id, shelf) => {
                setSelectedZero2wDeviceId(id);
                setSelectedZero2wShelf(shelf);
              }}
              onShelfPick={setSelectedZero2wShelf}
              onSave={() => {
                if (!selectedZero2wDevice) return;
                assignZero2w.mutate(
                  { clientDeviceId: selectedZero2wDevice.id, shelfCodeRaw: selectedZero2wShelf },
                  {
                    onSuccess: () => setMessage('Zero2W 担当棚を更新しました'),
                    onError: (e: unknown) => setMessage(e instanceof Error ? e.message : '更新に失敗しました')
                  }
                );
              }}
            />
          ) : (
            <>
              <ShelfFactoryMapView
                zoneId={zoneId}
                gridSize={gridSize}
                draftEntities={draftEntities}
                selectedCells={selectedCells}
                relocateSource={relocateSource}
                tab={tab}
                layoutEmphasizeCells={layoutGates.emphasize === 'cells'}
                relocateEmphasize={relocateGates.emphasize}
                relocateCellActionable={relocateGates.isCellActionable}
                relocateCellsDisabled={relocateGates.cellsDisabled}
                onOpenZone={onOpenZone}
                onToggleCell={toggleCell}
              />

              {tab === 'layout' && canEditLayout ? (
                <ShelfLayoutEditorDock
                  gates={layoutGates}
                  multiMode={multiMode}
                  gridSize={gridSize}
                  pendingKind={pendingKind}
                  selectedMachineCd={selectedMachineCd}
                  machines={machines}
                  savePending={saveMutation.isPending}
                  onToggleMulti={() => setMultiMode((v) => !v)}
                  onGridSizeChange={handleGridSizeChange}
                  onClearSelection={handleDeselectOnly}
                  onPickKind={setPendingKind}
                  onMachineChange={setSelectedMachineCd}
                  onAssign={handleAssign}
                  onClearCells={handleClearCells}
                  onSave={saveLayout}
                />
              ) : tab === 'relocate' ? (
                <ShelfRelocateDock statusText={relocateStatusText} />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
