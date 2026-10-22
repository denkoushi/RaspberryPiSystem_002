import { getMacroZoneById, type MacroZoneId } from '@raspi-system/shelf-layout-core';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { HaizenHeader } from '../../haizen/HaizenHeader';
import { HaizenIcon } from '../../haizen/HaizenIcon';
import { isMobilePlacementShelfRegisterRouteState } from '../../shelfSelection';
import { haizenPhoneStyle, hp } from '../../ui/haizenPhoneTokens';
import { getRelocateFlowGates } from '../flow/relocateFlow';
import { entityAtCell } from '../model/shelfLayoutGrid';
import { phoneShelfTheme as t } from '../theme/phoneShelfMasterTheme';
import { useClientCapabilities, useHaizenTargetDevicesForShelfMaster, useMachineMasters, useRelocateShelf, useShelfLayoutSummary, useShelfLayoutZone } from '../useShelfMasterQueries';

import { ShelfPhoneLayout } from './ShelfPhoneLayout';
import { ShelfPhoneLegend, ShelfPhoneMap, ShelfPhoneMode, ShelfPhoneZoneGrid } from './ShelfPhoneMap';
import { ShelfPhotoMaster } from './ShelfPhotoMaster';

export function ShelfMasterPhonePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const caps = useClientCapabilities();
  const summary = useShelfLayoutSummary();
  const machines = useMachineMasters();
  const devices = useHaizenTargetDevicesForShelfMaster();
  const [mode, setMode] = useState<'photo' | 'relocate' | 'layout'>('photo');
  const [zoneId, setZoneId] = useState<MacroZoneId | null>(null);
  // Keep the source outside the zone component so it survives navigation between zones.
  const [source, setSource] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const canEdit = caps.data?.shelfLayoutEditEnabled === true;
  const zeroShelves = new Set((devices.data?.devices ?? []).flatMap((d) => d.shelfCodeRaw ? [d.shelfCodeRaw] : []));
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const changeMode = (next: 'photo' | 'relocate' | 'layout') => { setMode(next); setSource(null); if (next === 'photo') setZoneId(null); };
  const backToHub = () => navigate('/kiosk/mobile-placement', {
    state: isMobilePlacementShelfRegisterRouteState(location.state) ? location.state : undefined,
  });

  return <div className={hp.screen} style={haizenPhoneStyle}><div className={hp.content}>
    {zoneId && mode === 'layout' && canEdit ? <ShelfPhoneLayout key={zoneId} zoneId={zoneId} machines={machines.data?.machines ?? []}
      onBack={() => setZoneId(null)} onOpen={setZoneId} onMode={changeMode} onMessage={setToast} />
      : <>
        <HaizenHeader title={zoneId ? getMacroZoneById(zoneId).displayName : '棚マスタ'} onBack={zoneId ? () => setZoneId(null) : backToHub} />
        <ShelfPhoneMode mode={mode} canEdit={canEdit} onChange={changeMode} />
        {mode === 'photo' ? <ShelfPhotoMaster /> : zoneId ? <ShelfPhoneRelocate zoneId={zoneId} source={source} setSource={setSource} zeroShelves={zeroShelves} onOpen={setZoneId} onMessage={setToast} />
          : <>
            {summary.isLoading ? <p className={hp.empty}>読込中…</p> : summary.isError ? <p role="alert" className={`${hp.empty} !text-[var(--hp-ng)]`}>配置を取得できませんでした</p>
              : <ShelfPhoneMap zones={summary.data?.zones ?? []} zeroShelves={zeroShelves} onOpen={setZoneId} />}
            <div className={t.dock}>
              <div className={t.status}><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--hp-shelf)]" />{source ? <><span className="min-w-0 break-words"><span className="font-mono text-[var(--hp-shelf)]">{source}</span> の置き先をタップ</span><button className={`${hp.mini} ml-auto shrink-0`} onClick={() => setSource(null)}>やめる</button></> : '区画をタップ'}</div>
              <ShelfPhoneLegend />
            </div>
          </>}
      </>}
    {toast && <div role="status" className="pointer-events-none absolute bottom-24 left-3.5 right-3.5 z-20 flex items-center gap-2.5 rounded-[14px] bg-[var(--hp-ink)] px-4 py-[13px] text-[15px] font-black text-[var(--hp-bg)]"><HaizenIcon name="check" /><span className="break-words">{toast}</span></div>}
  </div></div>;
}

function ShelfPhoneRelocate({ zoneId, source, setSource, zeroShelves, onOpen, onMessage }: {
  zoneId: MacroZoneId; source: string | null; setSource: (value: string | null) => void;
  zeroShelves: Set<string>; onOpen: (zone: MacroZoneId) => void; onMessage: (message: string) => void;
}) {
  const query = useShelfLayoutZone(zoneId);
  const relocate = useRelocateShelf();
  const [error, setError] = useState<string | null>(null);
  const gates = getRelocateFlowGates({ relocateSource: source, relocatePending: relocate.isPending });
  const onCell = (cells: number[]) => {
    if (gates.cellsDisabled || !query.data) return;
    const entity = entityAtCell(query.data.entities, cells[0]);
    if (source && entity?.shelfCodeRaw === source) { setSource(null); setError(null); return; }
    if (!entity?.shelfCodeRaw || !gates.isCellActionable(entity)) {
      setError('置き先は登録済みの棚を選んでください');
      return;
    }
    setError(null);
    if (!source || source === entity.shelfCodeRaw) { setSource(source ? null : entity.shelfCodeRaw); return; }
    // Existing relocation moves operational data between registered shelves only.
    relocate.mutate({ sourceShelfCodeRaw: source, targetShelfCodeRaw: entity.shelfCodeRaw }, {
      onSuccess: () => { setSource(null); onMessage(`${source} を ${entity.shelfCodeRaw} に移しました`); },
      onError: (e) => setError(e instanceof Error ? e.message : '移動に失敗しました'),
    });
  };
  return <>
    {query.isLoading ? <p className={hp.empty}>読込中…</p> : query.isError ? <p role="alert" className={`${hp.empty} !text-[var(--hp-ng)]`}>配置を取得できませんでした</p>
      : query.data && <ShelfPhoneZoneGrid zoneId={zoneId} gridSize={query.data.gridSize} entities={query.data.entities} source={source}
        zeroShelves={zeroShelves} disabled={relocate.isPending} onOpen={onOpen} onCell={onCell} />}
    <div className={t.dock}>
      <div className={t.status}><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--hp-shelf)]" />
        <span className="min-w-0 break-words">{relocate.isPending ? '移動中…' : source ? <><span className="font-mono text-[var(--hp-shelf)]">{source}</span> の置き先をタップ</> : '動かす棚をタップ'}</span>
        {source && <button type="button" className={`${hp.mini} ml-auto shrink-0`} disabled={relocate.isPending} onClick={() => { setSource(null); setError(null); }}>やめる</button>}
      </div>
      {error && <p role="alert" className="text-xs text-[var(--hp-ng)]">{error}</p>}
      <ShelfPhoneLegend />
    </div>
  </>;
}
