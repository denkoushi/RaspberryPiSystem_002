import { useEffect, useRef, useState } from 'react';

import { getProcedureMaterialThumbnail, listProcedureMaterials, listProcedureMaterialsByEmployeeTag } from '../../../api/client';
import { useNfcStream } from '../../../hooks/useNfcStream';
import { WorkInstructionEditorIcon } from '../../work-instructions/WorkInstructionEditorControls';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';
import { ProcedureMaterialPhotoCache } from '../procedure-manuals/procedure-material-photo-cache';

import type { useMaterialDrag } from './useMaterialDrag';
import type { ProcedureMaterialDto } from '../procedure-manuals/procedure-material-types';

export function DocumentEditorMaterials({ revision, disabled, drag }: {
  revision: number;
  disabled: boolean;
  drag: Pick<ReturnType<typeof useMaterialDrag>, 'onPointerDown' | 'onClick'> & { activeMaterialId?: string | null };
}) {
  const [materials, setMaterials] = useState<ProcedureMaterialDto[]>([]);
  const [photoCache] = useState(() => new ProcedureMaterialPhotoCache());
  useEffect(() => () => photoCache.clear(), [photoCache]);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<{ openedAt: number; uid?: string; employee?: { employeeCode: string; displayName: string } } | null>(null);
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const employeeRevision = useRef<number | null>(null);
  const processed = useRef(new Set<string>());
  const nfcEvent = useNfcStream(Boolean(gate && !gate.employee && !checking), undefined, { suppressInventoryRouting: true });
  useEffect(() => () => { generation.current += 1; }, []);
  const close = () => {
    generation.current += 1;
    inFlight.current = false;
    setChecking(false);
    employeeRevision.current = null;
    setGate(null);
    setMaterials([]);
    setError(null);
  };
  const gateOpen = gate !== null;
  const gateUid = gate?.uid;
  useEffect(() => {
    let cancelled = false;
    if (gateOpen && (!gateUid || employeeRevision.current === revision)) return;
    setError(null);
    const request = gateUid ? listProcedureMaterialsByEmployeeTag(gateUid).then(result => result.materials.map(material => ({ ...material, employeeTagUid: gateUid }))) : listProcedureMaterials({ state: 'unplaced', limit: 500 });
    void request.then(rows => {
      if (!cancelled) setMaterials(rows.filter(row => row.kind !== 'PDF' && !row.placedAt && !row.documentId && !row.discardedAt));
    }).catch(error => { if (!cancelled) setError(gateUid ? readAssemblyApiErrorMessage(error, '素材を取得できませんでした。') : '素材を取得できませんでした。'); });
    return () => { cancelled = true; };
  }, [revision, gateUid, gateOpen]);
  useEffect(() => {
    if (!gate || gate.employee || !nfcEvent || inFlight.current) return;
    const timestamp = Date.parse(nfcEvent.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < gate.openedAt) return;
    const key = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (processed.current.has(key)) return;
    processed.current.add(key);
    const scope = generation.current;
    inFlight.current = true;
    setChecking(true);
    setError(null);
    void listProcedureMaterialsByEmployeeTag(nfcEvent.uid).then(result => {
      if (scope !== generation.current) return;
      employeeRevision.current = revision;
      setMaterials(result.materials.map(material => ({ ...material, employeeTagUid: nfcEvent.uid })));
      setGate({ ...gate, uid: nfcEvent.uid, employee: result.employee });
    }).catch(error => {
      if (scope !== generation.current) return;
      const status = (error as { response?: { status?: number } } | null)?.response?.status;
      setError(status === 404 ? '登録されていないタグです' : readAssemblyApiErrorMessage(error, '素材を取得できませんでした。'));
    }).finally(() => {
      if (scope !== generation.current) return;
      inFlight.current = false;
      setChecking(false);
    });
  }, [gate, nfcEvent, revision]);
  return <div className={`grid gap-2 ${gate && !gate.employee ? 'h-full min-h-[320px] grid-rows-[44px_minmax(0,1fr)]' : 'content-start'}`}>
    {gate ? <>
      <div className="flex h-11 items-center gap-2 rounded-lg border border-[#5fc3e8] bg-[#5fc3e814] pl-2.5 pr-1 text-base">
        {gate.employee ? <><b className="font-mono text-[17px] text-[#5fc3e8]">{gate.employee.employeeCode}</b><span>{gate.employee.displayName}</span></> : '社員番号'}
        <span className="ml-auto font-mono text-[#9fadb9]">{gate.employee ? materials.length : ''}</span>
        <button type="button" aria-label="閉じる" onClick={close} className="grid h-9 w-9 place-items-center rounded-md text-[#9fadb9]"><WorkInstructionEditorIcon name="close" className="h-[18px] w-[18px]" /></button>
      </div>
      {!gate.employee ? <div className="grid content-center justify-items-center gap-[22px] px-3 text-center">
        <WorkInstructionEditorIcon name="nfc" className="h-[120px] w-[120px] text-[#5fc3e8]" />
        {error ? <p role="alert" className="text-base text-[#e5484d]">{error}</p> : null}
        <h3 role={checking ? 'status' : undefined} className="text-2xl font-bold tracking-[0.12em]">{checking ? '確認中…' : '社員タグ'}</h3>
      </div> : null}
    </> : <button type="button" onClick={() => { generation.current += 1; setGate({ openedAt: Date.now() }); setMaterials([]); setError(null); }} className="flex h-12 items-center gap-2.5 rounded-lg border border-[#344252] px-3 text-base hover:border-[#5fc3e8]">
      <WorkInstructionEditorIcon name="nfc" className="h-[26px] w-[26px] text-[#5fc3e8]" />社員番号
    </button>}
    {error && (!gate || gate.employee) ? <p role="alert">{error}</p> : null}
    {(!gate || gate.employee) && materials.map(material => <button key={material.id} type="button" disabled={disabled}
      aria-label={`素材を置く: ${material.text || material.originalFileName || material.subjectHint || '写真'}`}
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => drag.onPointerDown(material, event)} onClick={() => drag.onClick(material)}
      className={`select-none overflow-hidden rounded-lg border bg-white text-left text-slate-900 disabled:opacity-40 ${drag.activeMaterialId === material.id ? 'border-blue-400 ring-2 ring-blue-400' : 'border-[#344252]'}`} style={{ touchAction: 'pan-y', userSelect: 'none' }}>
      {material.kind === 'PHOTO' ? <MaterialPhoto id={material.id} cache={photoCache} /> : <span className="block h-28 overflow-hidden whitespace-pre-wrap break-words p-3">{material.text}</span>}
    </button>)}
  </div>;
}

function MaterialPhoto({ id, cache }: { id: string; cache: ProcedureMaterialPhotoCache }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let request: ReturnType<ProcedureMaterialPhotoCache['request']> | undefined;
    const load = () => {
      if (request || cancelled) return;
      request = cache.request(id, () => getProcedureMaterialThumbnail(id));
      void request.promise.then(value => { if (!cancelled) setUrl(value); }).catch(() => { /* Keep the card usable if its thumbnail fails. */ });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect(); }
    });
    if (observer && ref.current) observer.observe(ref.current);
    else load();
    return () => { cancelled = true; observer?.disconnect(); request?.release(); };
  }, [id, cache]);
  return <span ref={ref} className="block h-28">{url ? <img src={url} alt="" draggable={false} className="h-full w-full object-contain" /> : null}</span>;
}
