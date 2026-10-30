import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isMobilePlacementShelfRegisterRouteState } from '../../shelfSelection';
import { useRegisteredShelves } from '../../useRegisteredShelves';
import { useShelfMachines } from '../../useShelfMachines';
import { useShelfOfflineQueue } from '../offline/useShelfOfflineQueue';
import { clearShelfPhotoDraft, readShelfPhotoDraft } from '../shelfPhotoDraft';
import { useHaizenTargetDevicesForShelfMaster } from '../useShelfMasterQueries';

import { KioskShelfPhoto, ShelfCompass } from './ShelfCompass';
import { ShelfKioskEditor, useDeleteConfirmation } from './ShelfKioskEditor';
import { ShelfKioskHeader } from './ShelfKioskHeader';
import { displayName, shelfPosition } from './shelfKioskModel';
import { ShelfLandmarkList } from './ShelfLandmarkList';
import './shelfKiosk.css';

import type { KioskShelf, Landmark } from './shelfKioskModel';
import type { ShelfDirection } from '@raspi-system/shelf-layout-core';

type Editing = { key: string; item?: KioskShelf; initial?: { machine: string; direction: ShelfDirection | '' | null; memo?: string } };
export function ShelfMasterKioskPage() {
  const query = useRegisteredShelves();
  const machinesQuery = useShelfMachines();
  const devicesQuery = useHaizenTargetDevicesForShelfMaster();
  const queue = useShelfOfflineQueue();
  const navigate = useNavigate();
  const location = useLocation();
  const [selected, setSelected] = useState(() => readShelfPhotoDraft()?.machine ?? '');
  const [editing, setEditing] = useState<Editing | null>(() => { const draft = readShelfPhotoDraft(); return draft ? { key: 'draft', initial: draft } : null; });
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 2500); return () => window.clearTimeout(timer); }, [toast]);
  const queuedCodes = new Set(queue.records.map((r) => r.shelfCodeRaw));
  const shelves: KioskShelf[] = [...(query.data?.shelves ?? []).filter((s) => !queuedCodes.has(s.shelfCodeRaw)).map((shelf) => ({ shelfCodeRaw: shelf.shelfCodeRaw, shelf })), ...queue.records.map((record) => ({ shelfCodeRaw: record.shelfCodeRaw, record }))];
  const marks: Landmark[] = [...(machinesQuery.data?.machines ?? []).map((name) => ({ name, kind: '加工機' })), ...(machinesQuery.data?.landmarks ?? []).map((name) => ({ name, kind: '目安' }))];
  if (shelves.some((s) => !shelfPosition(s.shelfCodeRaw, marks))) marks.push({ name: 'その他', kind: '', other: true });
  const mark = marks.find((m) => m.name === selected) ?? marks[0];
  const close = () => { if (!editing?.item) clearShelfPhotoDraft(); setEditing(null); };
  const devices = devicesQuery.data?.devices ?? [];
  return <div className="sk-screen" data-testid="shelf-master-kiosk"><ShelfKioskHeader count={shelves.length} used={devices.filter((d) => d.shelfCodeRaw).length} total={devices.length} pending={queue.records.length} onBack={() => navigate('/kiosk/mobile-placement', { state: isMobilePlacementShelfRegisterRouteState(location.state) ? location.state : undefined })} />
    <div className="sk-main"><ShelfLandmarkList marks={marks} shelves={shelves} selected={mark?.name} onSelect={(name) => { setSelected(name); setEditing(null); }} />
      <div className="sk-center">{query.isLoading || machinesQuery.isLoading ? <p>読込中…</p> : query.isError || machinesQuery.isError ? <p role="alert">{query.isError ? '棚を取得できませんでした' : '目安を取得できませんでした'} <button type="button" onClick={() => { void query.refetch(); void machinesQuery.refetch(); }}>再試行</button></p> : <ShelfCompass mark={mark} marks={marks} shelves={shelves} selectedCode={editing?.item?.shelfCodeRaw} selectedDirection={editing?.initial?.machine === mark?.name ? editing?.initial?.direction : undefined} devices={devices} onShelf={(item) => setEditing({ key: item.shelfCodeRaw, item })} onNew={(direction) => { if (mark) setEditing({ key: `${mark.name}:${direction}`, initial: { machine: mark.name, direction } }); }} />}</div>
      {editing?.item?.record ? <QueueEditor key={editing.key} item={editing.item} remove={queue.remove} onClose={close} /> : editing ? <ShelfKioskEditor key={editing.key} shelf={editing.item?.shelf ?? null} shelves={shelves.map((s) => s.shelf ?? { shelfCodeRaw: s.shelfCodeRaw, isStructured: true })} initial={editing.initial} machinesQuery={machinesQuery} devicesQuery={devicesQuery} submit={queue.submit} onClose={close} onMessage={setToast} /> : <section className="sk-editor" aria-label="棚" />}
    </div>{toast && <div className="sk-toast" role="status">{toast}</div>}
  </div>;
}
function QueueEditor({ item, remove, onClose }: { item: KioskShelf; remove: (id: string) => Promise<void>; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDeleteConfirmation(confirmed, () => setConfirmed(false));
  return <section className="sk-editor" aria-label="要確認"><div className="sk-photo"><KioskShelfPhoto item={item} /></div><b>{displayName(item.shelfCodeRaw)}</b><p>{item.record?.message}</p>{error && <p role="alert">{error}</p>}<button type="button" className="sk-delete" disabled={busy} onClick={() => { if (!confirmed) { setConfirmed(true); return; } if (!item.record) return; setBusy(true); void remove(item.record.id).then(onClose).catch((e: unknown) => setError(e instanceof Error ? e.message : '削除できませんでした')).finally(() => setBusy(false)); }}>{confirmed ? '本当に消す' : '消す'}</button></section>;
}
