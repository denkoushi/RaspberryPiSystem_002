import {
  MACRO_ZONE_CATALOG,
  getMacroZoneById,
  getNeighborMacroZoneId,
  indexToRc,
  type MacroZoneId
} from '@raspi-system/shelf-layout-core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { mpKioskTheme } from '../ui/mobilePlacementKioskTheme';

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

import type { ShelfLayoutEntityDto } from '../../../api/client';

type UiTab = 'layout' | 'relocate' | 'zero2w';
type DraftEntity = Omit<ShelfLayoutEntityDto, 'id'> & { id?: string };

const ZONE_COLORS = ['#f59e0b', '#7c3aed', '#dc2626', '#16a34a', '#6b7280', '#78350f', '#ea580c', '#2563eb', '#ec4899'];

function entityAtCell(entities: DraftEntity[], cellIndex: number): DraftEntity | null {
  return entities.find((e) => e.cellIndices.includes(cellIndex)) ?? null;
}

function buildRenderItems(entities: DraftEntity[], gridSize: number) {
  const covered = new Set<number>();
  const items: Array<{
    entity: DraftEntity | null;
    minR: number;
    maxR: number;
    minC: number;
    maxC: number;
    cells: number[];
  }> = [];
  for (const e of entities) {
    const rs = e.cellIndices.map((i) => indexToRc(i, gridSize).r);
    const cs = e.cellIndices.map((i) => indexToRc(i, gridSize).c);
    const minR = Math.min(...rs);
    const maxR = Math.max(...rs);
    const minC = Math.min(...cs);
    const maxC = Math.max(...cs);
    e.cellIndices.forEach((i) => covered.add(i));
    items.push({ entity: e, minR, maxR, minC, maxC, cells: e.cellIndices });
  }
  const max = gridSize * gridSize;
  for (let i = 0; i < max; i += 1) {
    if (!covered.has(i)) {
      const { r, c } = indexToRc(i, gridSize);
      items.push({ entity: null, minR: r, maxR: r, minC: c, maxC: c, cells: [i] });
    }
  }
  return items;
}

function entityLabel(entity: DraftEntity | null): string {
  if (!entity) return '—';
  if (entity.entityKind === 'MACHINE') return entity.resourceName ?? '加工機';
  if (entity.entityKind === 'SHELF') return entity.displayLabel ?? entity.shelfCodeRaw ?? '棚';
  if (entity.entityKind === 'AISLE') return entity.aisleLabel ?? '通路';
  return '—';
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
      setGridSize(zoneQuery.data.gridSize);
      setDraftEntities(zoneQuery.data.entities);
      setSelectedCells([]);
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

  const onOpenZone = (id: MacroZoneId) => {
    setZoneId(id);
    setMessage(null);
  };

  const onBackFactory = () => {
    setZoneId(null);
    setSelectedCells([]);
    setRelocateSource(null);
    setMessage(null);
  };

  const toggleCell = (cells: number[]) => {
    if (tab === 'relocate') {
      const entity = entityAtCell(draftEntities, cells[0] ?? -1);
      if (entity?.entityKind !== 'SHELF' || !entity.shelfCodeRaw) return;
      if (!relocateSource) {
        setRelocateSource(entity.shelfCodeRaw);
        setMessage(`移動元: ${entity.displayLabel ?? entity.shelfCodeRaw}`);
        return;
      }
      if (relocateSource === entity.shelfCodeRaw) {
        setRelocateSource(null);
        setMessage(null);
        return;
      }
      relocateMutation.mutate(
        { sourceShelfCodeRaw: relocateSource, targetShelfCodeRaw: entity.shelfCodeRaw },
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

  const applyAssignment = () => {
    if (!canEditLayout || selectedCells.length === 0 || !pendingKind) return;
    const sorted = [...selectedCells].sort((a, b) => a - b);
    const withoutOverlap = draftEntities
      .map((e) => ({
        ...e,
        cellIndices: e.cellIndices.filter((i) => !sorted.includes(i))
      }))
      .filter((e) => e.cellIndices.length > 0);

    if (pendingKind === 'UNUSED' || pendingKind === 'AISLE') {
      setDraftEntities([
        ...withoutOverlap,
        {
          entityKind: pendingKind,
          cellIndices: sorted,
          resourceCd: null,
          resourceName: null,
          shelfCodeRaw: null,
          displayLabel: null,
          aisleLabel: pendingKind === 'AISLE' ? '通路' : null
        }
      ]);
      setSelectedCells([]);
      return;
    }

    if (pendingKind === 'MACHINE') {
      const master = machines.find((m) => m.resourceCd === selectedMachineCd);
      if (!master) {
        setMessage('加工機マスタを選択してください');
        return;
      }
      setDraftEntities([
        ...withoutOverlap,
        {
          entityKind: 'MACHINE',
          cellIndices: sorted,
          resourceCd: master.resourceCd,
          resourceName: master.resourceName,
          shelfCodeRaw: null,
          displayLabel: null,
          aisleLabel: null
        }
      ]);
      setSelectedCells([]);
      return;
    }

    if (pendingKind === 'SHELF') {
      const existing = sorted.map((i) => entityAtCell(draftEntities, i)).find((e) => e?.entityKind === 'SHELF');
      setDraftEntities([
        ...withoutOverlap,
        {
          entityKind: 'SHELF',
          cellIndices: sorted,
          resourceCd: null,
          resourceName: null,
          shelfCodeRaw: existing?.shelfCodeRaw ?? null,
          displayLabel: existing?.displayLabel ?? null,
          aisleLabel: null
        }
      ]);
      setSelectedCells([]);
    }
  };

  const clearSelection = () => {
    if (selectedCells.length === 0) return;
    setDraftEntities(
      draftEntities
        .map((e) => ({ ...e, cellIndices: e.cellIndices.filter((i) => !selectedCells.includes(i)) }))
        .filter((e) => e.cellIndices.length > 0)
    );
    setSelectedCells([]);
  };

  const saveLayout = () => {
    if (!zoneId || !zoneQuery.data) return;
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
        onSuccess: () => setMessage('レイアウトを保存しました'),
        onError: (e: unknown) => setMessage(e instanceof Error ? e.message : '保存に失敗しました')
      }
    );
  };

  const selectedZero2wDevice = zero2wDevices.find((d) => d.id === selectedZero2wDeviceId) ?? null;

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
            <button type="button" className={tab === 'layout' ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton} onClick={() => setTab('layout')}>
              レイアウト
            </button>
          ) : null}
          <button type="button" className={tab === 'relocate' ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton} onClick={() => setTab('relocate')}>
            再割当
          </button>
          <button type="button" className={tab === 'zero2w' ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton} onClick={() => setTab('zero2w')}>
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
            <div className="mx-auto w-full max-w-lg space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
              <label className="block text-xs font-semibold text-slate-300">Zero2W 端末</label>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-2 text-sm"
                value={selectedZero2wDeviceId}
                onChange={(e) => {
                  setSelectedZero2wDeviceId(e.target.value);
                  const dev = zero2wDevices.find((d) => d.id === e.target.value);
                  setSelectedZero2wShelf(dev?.shelfCodeRaw ?? '');
                }}
              >
                <option value="">— 選択 —</option>
                {zero2wDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <label className="block text-xs font-semibold text-slate-300">担当棚</label>
              <div className="flex flex-wrap gap-2">
                {shelfEntities.map((s) => (
                  <button
                    key={s.shelfCodeRaw}
                    type="button"
                    className={
                      selectedZero2wShelf === s.shelfCodeRaw
                        ? 'rounded-lg border-2 border-amber-500 bg-amber-950 px-2 py-1 text-xs font-bold text-amber-100'
                        : 'rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs'
                    }
                    onClick={() => setSelectedZero2wShelf(s.shelfCodeRaw ?? '')}
                  >
                    <div>{s.displayLabel ?? s.shelfCodeRaw}</div>
                    <div className="font-mono text-[10px] text-sky-300">{s.shelfCodeRaw}</div>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={mpKioskTheme.partSearchButtonActive}
                disabled={!selectedZero2wDevice || !selectedZero2wShelf || assignZero2w.isPending}
                onClick={() => {
                  if (!selectedZero2wDevice) return;
                  assignZero2w.mutate(
                    { clientDeviceId: selectedZero2wDevice.id, shelfCodeRaw: selectedZero2wShelf },
                    {
                      onSuccess: () => setMessage('Zero2W 担当棚を更新しました'),
                      onError: (e: unknown) => setMessage(e instanceof Error ? e.message : '更新に失敗しました')
                    }
                  );
                }}
              >
                保存
              </button>
            </div>
          ) : (
            <>
              <div className="mx-auto grid w-full max-w-2xl grid-cols-[1fr_auto_2fr_auto_1fr] grid-rows-[1fr_auto_2fr_auto_1fr] gap-1 aspect-square max-h-[52vh]">
                {(['nw', 'n', 'ne', 'w', null, 'e', 'sw', 's', 'se'] as const).map((dir, idx) => {
                  if (dir === null) {
                    return (
                      <div key={`c-${idx}`} className="col-start-3 row-start-3 flex flex-col rounded-xl border-2 border-amber-400 bg-amber-950/20 p-1">
                        <div className="text-center text-[10px] font-bold text-amber-100">{getMacroZoneById(zoneId).displayName}</div>
                        <div
                          className="grid flex-1 gap-0.5"
                          style={{
                            gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`
                          }}
                        >
                          {buildRenderItems(draftEntities, gridSize).map((item) => {
                            const kind = item.entity?.entityKind?.toLowerCase() ?? 'unused';
                            const sel = item.cells.some((c) => selectedCells.includes(c));
                            const isRelocateSource = item.entity?.shelfCodeRaw === relocateSource;
                            return (
                              <button
                                key={item.cells.join('-')}
                                type="button"
                                className={`flex min-h-0 flex-col items-center justify-center rounded-md border p-0.5 text-[9px] font-bold ${kind === 'machine' ? 'border-slate-500 bg-slate-700' : ''} ${kind === 'shelf' ? 'border-amber-700 bg-amber-950 text-amber-100' : ''} ${kind === 'aisle' ? 'border-dashed border-sky-600 bg-sky-950/30' : ''} ${kind === 'unused' ? 'border-slate-800 bg-slate-900/50 text-slate-500' : ''} ${sel ? 'outline outline-2 outline-sky-400' : ''} ${isRelocateSource ? 'outline outline-2 outline-emerald-400' : ''}`}
                                style={{
                                  gridColumn: `${item.minC + 1} / ${item.maxC + 2}`,
                                  gridRow: `${item.minR + 1} / ${item.maxR + 2}`
                                }}
                                onClick={() => toggleCell(item.cells)}
                              >
                                <span>{entityLabel(item.entity)}</span>
                                {item.entity?.shelfCodeRaw ? (
                                  <span className="font-mono text-[8px] text-sky-300">{item.entity.shelfCodeRaw}</span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  const neighborId = getNeighborMacroZoneId(zoneId, dir);
                  if (!neighborId) return <div key={dir} />;
                  const neighbor = getMacroZoneById(neighborId);
                  return (
                    <button
                      key={dir}
                      type="button"
                      className="rounded-lg border border-white/10 bg-black/40 p-1 text-[9px] font-bold text-slate-400"
                      style={{
                        gridColumn: dir === 'nw' || dir === 'w' || dir === 'sw' ? 1 : dir === 'n' || dir === 's' ? 3 : 5,
                        gridRow: dir === 'nw' || dir === 'n' || dir === 'ne' ? 1 : dir === 'w' || dir === 'e' ? 3 : 5
                      }}
                      onClick={() => onOpenZone(neighborId)}
                    >
                      {neighbor.displayName}
                    </button>
                  );
                })}
              </div>

              {tab === 'layout' && canEditLayout ? (
                <div className="mx-auto w-full max-w-lg space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={multiMode ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton} onClick={() => setMultiMode((v) => !v)}>
                      {multiMode ? '☑ 複数マス' : '☐ 複数マス'}
                    </button>
                    <select
                      className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-xs"
                      value={gridSize}
                      onChange={(e) => setGridSize(Number(e.target.value) as 3 | 4)}
                    >
                      <option value={3}>3×3</option>
                      <option value={4}>4×4</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['SHELF', 'MACHINE', 'AISLE', 'UNUSED'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={pendingKind === k ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton}
                        onClick={() => setPendingKind(k)}
                      >
                        {k === 'SHELF' ? '部品置き場' : k === 'MACHINE' ? '加工機' : k === 'AISLE' ? '通路' : '解除'}
                      </button>
                    ))}
                    <button type="button" className={mpKioskTheme.partSearchButton} onClick={clearSelection}>
                      選択解除
                    </button>
                  </div>
                  {pendingKind === 'MACHINE' ? (
                    <select
                      className="w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-2 text-sm"
                      value={selectedMachineCd}
                      onChange={(e) => setSelectedMachineCd(e.target.value)}
                    >
                      <option value="">— マスタから選択 —</option>
                      {machines.map((m) => (
                        <option key={m.resourceCd} value={m.resourceCd}>
                          {m.resourceName} ({m.resourceCd})
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button type="button" className={mpKioskTheme.partSearchButtonActive} onClick={applyAssignment} disabled={selectedCells.length === 0 || !pendingKind}>
                    選択マスに割当
                  </button>
                  <button type="button" className={mpKioskTheme.partSearchButtonActive} onClick={saveLayout} disabled={saveMutation.isPending}>
                    レイアウト保存
                  </button>
                </div>
              ) : tab === 'relocate' ? (
                <p className="text-center text-xs text-slate-400">部品置き場を2回タップ（移動元 → 移動先）</p>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
