import { type MacroZoneId } from '@raspi-system/shelf-layout-core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { mpKioskTheme } from '../ui/mobilePlacementKioskTheme';

import { ShelfMacroOverviewGrid } from './components/ShelfMacroOverviewGrid';
import { ShelfZoneLayoutDialog } from './components/ShelfZoneLayoutDialog';
import { ShelfZoneRelocateDialog } from './components/ShelfZoneRelocateDialog';
import { useClientCapabilities, useMachineMasters, useShelfLayoutSummary } from './useShelfMasterQueries';

import type { ShelfLayoutSummaryDto } from '../../../api/client';

type UiTab = 'layout' | 'relocate';

export function ShelfMasterPageContent() {
  const navigate = useNavigate();
  const capsQuery = useClientCapabilities();
  const summaryQuery = useShelfLayoutSummary();
  const machinesQuery = useMachineMasters();

  const canEditLayout = capsQuery.data?.shelfLayoutEditEnabled === true;
  const [tab, setTab] = useState<UiTab>('relocate');
  const [layoutEditZoneId, setLayoutEditZoneId] = useState<MacroZoneId | null>(null);
  const [relocateZoneId, setRelocateZoneId] = useState<MacroZoneId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const machines = machinesQuery.data?.machines ?? [];
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
        </div>
      </div>

      {message ? <div className="shrink-0 bg-emerald-950 px-3 py-1.5 text-xs text-emerald-200">{message}</div> : null}

      {summaryQuery.isLoading ? (
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
