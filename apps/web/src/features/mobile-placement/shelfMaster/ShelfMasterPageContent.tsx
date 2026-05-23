import { type MacroZoneId } from '@raspi-system/shelf-layout-core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { mpKioskTheme } from '../ui/mobilePlacementKioskTheme';

import { ShelfMacroOverviewGrid } from './components/ShelfMacroOverviewGrid';
import { ShelfZero2wPanel } from './components/ShelfZero2wPanel';
import { ShelfZoneLayoutDialog } from './components/ShelfZoneLayoutDialog';
import { ShelfZoneRelocateDialog } from './components/ShelfZoneRelocateDialog';
import { getZero2wAssignmentFlowGates } from './flow/zero2wAssignmentFlow';
import { draftEntitiesFromSummary } from './model/summaryEntities';
import {
  useAssignZero2wPreset,
  useClientCapabilities,
  useHaizenTargetDevicesForShelfMaster,
  useMachineMasters,
  useShelfLayoutSummary
} from './useShelfMasterQueries';

import type { DraftEntity } from './model/shelfLayoutTypes';
import type { ShelfLayoutSummaryDto } from '../../../api/client';

type UiTab = 'layout' | 'relocate' | 'zero2w';

export function ShelfMasterPageContent() {
  const navigate = useNavigate();
  const capsQuery = useClientCapabilities();
  const summaryQuery = useShelfLayoutSummary();
  const machinesQuery = useMachineMasters();
  const zero2wQuery = useHaizenTargetDevicesForShelfMaster();
  const assignZero2w = useAssignZero2wPreset();

  const canEditLayout = capsQuery.data?.shelfLayoutEditEnabled === true;
  const [tab, setTab] = useState<UiTab>('relocate');
  const [layoutEditZoneId, setLayoutEditZoneId] = useState<MacroZoneId | null>(null);
  const [relocateZoneId, setRelocateZoneId] = useState<MacroZoneId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedZero2wDeviceId, setSelectedZero2wDeviceId] = useState('');
  const [selectedZero2wShelf, setSelectedZero2wShelf] = useState('');

  useEffect(() => {
    if (canEditLayout) {
      setTab('layout');
    }
  }, [canEditLayout]);

  const zonesById = useMemo(() => {
    const map = new Map<string, ShelfLayoutSummaryDto>();
    for (const z of summaryQuery.data?.zones ?? []) {
      map.set(z.macroZoneId, z);
    }
    return map;
  }, [summaryQuery.data?.zones]);

  const allShelfEntities = useMemo((): DraftEntity[] => {
    const out: DraftEntity[] = [];
    for (const z of summaryQuery.data?.zones ?? []) {
      for (const e of draftEntitiesFromSummary(z.entities ?? [])) {
        if (e.entityKind === 'SHELF' && e.shelfCodeRaw) {
          out.push(e);
        }
      }
    }
    return out;
  }, [summaryQuery.data?.zones]);

  const machines = machinesQuery.data?.machines ?? [];
  const zero2wDevices = zero2wQuery.data?.devices ?? [];

  const zero2wGates = getZero2wAssignmentFlowGates({
    selectedDeviceId: selectedZero2wDeviceId,
    selectedShelf: selectedZero2wShelf,
    savePending: assignZero2w.isPending
  });

  const selectedZero2wDevice = zero2wDevices.find((d) => d.id === selectedZero2wDeviceId) ?? null;

  const overviewMode = tab === 'layout' ? 'layout' : 'relocate';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-950 text-slate-50">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-700 px-2 py-1">
        <button type="button" className={mpKioskTheme.partSearchButton} onClick={() => navigate('/kiosk/mobile-placement')}>
          戻る
        </button>
        <h1 className="flex-1 text-xs font-bold">棚マスタ — 工場全体</h1>
        <div className="flex gap-1">
          {canEditLayout ? (
            <button
              type="button"
              className={tab === 'layout' ? mpKioskTheme.partSearchButtonActive : mpKioskTheme.partSearchButton}
              onClick={() => {
                setTab('layout');
                setRelocateZoneId(null);
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
              setLayoutEditZoneId(null);
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
              setLayoutEditZoneId(null);
              setRelocateZoneId(null);
              setMessage(null);
            }}
          >
            Zero2W
          </button>
        </div>
      </div>

      {message ? <div className="shrink-0 bg-emerald-950 px-3 py-1.5 text-xs text-emerald-200">{message}</div> : null}

      {tab === 'zero2w' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
          <ShelfZero2wPanel
            gates={zero2wGates}
            devices={zero2wDevices}
            shelfEntities={allShelfEntities}
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
        </div>
      ) : summaryQuery.isLoading ? (
        <p className="flex flex-1 items-center justify-center text-sm text-slate-400">読み込み中…</p>
      ) : (
        <ShelfMacroOverviewGrid
          zonesById={zonesById}
          overviewMode={overviewMode}
          showEditButton={tab === 'layout' && canEditLayout}
          onEditZone={(id) => setLayoutEditZoneId(id)}
          onRelocateZone={(id) => setRelocateZoneId(id)}
        />
      )}

      <ShelfZoneLayoutDialog
        zoneId={layoutEditZoneId}
        isOpen={layoutEditZoneId != null}
        machines={machines}
        onClose={() => setLayoutEditZoneId(null)}
        onZoneChange={(id) => setLayoutEditZoneId(id)}
        onMessage={setMessage}
      />

      <ShelfZoneRelocateDialog
        zoneId={relocateZoneId}
        isOpen={relocateZoneId != null}
        onClose={() => setRelocateZoneId(null)}
        onZoneChange={(id) => setRelocateZoneId(id)}
        onMessage={setMessage}
      />
    </div>
  );
}
