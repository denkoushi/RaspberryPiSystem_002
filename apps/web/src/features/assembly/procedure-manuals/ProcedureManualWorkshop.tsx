import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { deleteAssemblyProcedureDocument, getProcedureManualAssignments, getProcedureManualModelOverview, listAssemblyMachineNameCandidates, listProcedureManualModels, listProcedureManualProcesses, listProcedureMaterials, listProcedureVideos, replaceProcedureManualAssignments, verifyAssemblyTemplateAccessPassword } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Input } from '../../../components/ui/Input';
import { useProtectedImageBlobUrl } from '../../../hooks/useProtectedImageBlobUrl';
import { KioskPinDialog, kioskPinErrorResult } from '../../kiosk/KioskPinDialog';
import { kioskAssemblyManualsPath, kioskAssemblyManualsWorkshopPath, kioskAssemblyProcedureDocumentEditPath, kioskAssemblyTemplateNewPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';
import { PROCEDURE_EDITOR_ACCESS_HOURS, readProcedureEditorAccess, saveProcedureEditorAccess, subscribeProcedureEditorAccess } from '../procedureEditorAccess';

import { ProcedureManualAssignmentDialog, procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualBlankDialog } from './ProcedureManualBlankDialog';
import { ProcedureManualModelMatch, ProcedureManualModelTenkey } from './ProcedureManualModelSearch';
import { ProcedureMaterialShelfDialog } from './ProcedureMaterialShelfDialog';
import { ProcedureVideoShelfDialog } from './ProcedureVideoShelfDialog';

import type { ProcedureManualModelDto, ProcedureManualModelOverviewDto, ProcedureManualOverviewItemDto, ProcedureManualProcessDto } from '../types';

const action = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-[#344252] px-4 text-xl font-bold disabled:opacity-40';
const yellowAction = `${action} border-[#f6b93b] bg-[#f6b93b] text-[#0b1a12]`;
const badge = 'inline-flex min-h-8 items-center rounded-full border px-3 text-[17px] font-bold';
const shortName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';

function ManualThumbnail({ url }: { url: string | null }) {
  const { blobUrl } = useProtectedImageBlobUrl(url);
  return <div className="aspect-[1.414/1] w-[150px] overflow-hidden rounded-md border border-[#777] bg-white">
    {blobUrl ? <img src={blobUrl} alt="1ページ目" className="h-full w-full object-contain" /> : null}
  </div>;
}

export function ProcedureManualWorkshop() {
  const navigate = useNavigate();
  const [accessGranted, setAccessGranted] = useState(() => Boolean(readProcedureEditorAccess()));
  const checkAccess = useCallback(() => {
    const granted = Boolean(readProcedureEditorAccess());
    setAccessGranted(granted);
    return granted;
  }, []);
  useEffect(() => {
    checkAccess();
    // Access is sessionStorage-based: monitor this tab, not other tabs' sessions.
    return subscribeProcedureEditorAccess(checkAccess);
  }, [checkAccess]);
  const [params, setParams] = useSearchParams();
  const modelCodeKey = procedureManualModelKey(params.get('model') ?? '');
  const processId = params.get('process') ?? '';
  const [search, setSearch] = useState('');
  const [digitQuery, setDigitQuery] = useState('');
  const [models, setModels] = useState<ProcedureManualModelDto[]>([]);
  const [candidates, setCandidates] = useState<ProcedureManualModelDto[]>([]);
  const [processes, setProcesses] = useState<ProcedureManualProcessDto[]>([]);
  const [overview, setOverview] = useState<ProcedureManualModelOverviewDto | null>(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [blankOpen, setBlankOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [materialCount, setMaterialCount] = useState<number | null>(null);
  const [videoCount, setVideoCount] = useState<number | null>(null);
  const [removing, setRemoving] = useState<ProcedureManualOverviewItemDto | null>(null);
  const [deleting, setDeleting] = useState<ProcedureManualOverviewItemDto | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);
  useEffect(() => {
    let cancelled = false;
    void listProcedureManualProcesses().then(rows => { if (!cancelled) setProcesses(rows); })
      .catch(e => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '工程を取得できません')); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const sequence = ++requestSequence.current;
    setSearchLoading(true); setSearchError(null); setCandidates([]); setHasMore(false);
    const load = search || digitQuery
      ? listAssemblyMachineNameCandidates({ digitQuery, q: search, limit: 30 }).then(result => {
        if (sequence !== requestSequence.current) return;
        setCandidates([...new Set(result.candidates.map(procedureManualModelKey).filter(Boolean))].map(code => ({ modelCode: code, modelCodeKey: code })));
        setHasMore(result.hasMore);
      })
      : listProcedureManualModels().then(rows => {
        if (sequence !== requestSequence.current) return;
        const normalized = [...new Map(rows.map(row => {
          const code = procedureManualModelKey(row.modelCodeKey);
          return [code, { ...row, modelCodeKey: code }] as const;
        })).values()].filter(row => row.modelCodeKey);
        setModels(normalized); setCandidates(normalized);
      });
    void load.catch(e => { if (sequence === requestSequence.current) setSearchError(readAssemblyApiErrorMessage(e, '機種を検索できません')); })
      .finally(() => { if (sequence === requestSequence.current) setSearchLoading(false); });
    return () => { requestSequence.current += 1; };
  }, [search, digitQuery, version]);
  useEffect(() => {
    let cancelled = false;
    setOverview(null); setError(null); setOverviewLoading(Boolean(modelCodeKey));
    if (!modelCodeKey) return;
    void getProcedureManualModelOverview(modelCodeKey).then(next => { if (!cancelled) setOverview(next); })
      .catch(e => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '要領書を取得できません')); })
      .finally(() => { if (!cancelled) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, [modelCodeKey, version]);
  useEffect(() => {
    let cancelled = false;
    void listProcedureMaterials({ state: 'unplaced', limit: 500 }).then(rows => { if (!cancelled) setMaterialCount(rows.length); })
      .catch(() => { if (!cancelled) setMaterialCount(null); });
    return () => { cancelled = true; };
  }, [materialOpen]);
  useEffect(() => {
    let cancelled = false;
    void listProcedureVideos({ state: 'active', limit: 100 }).then(rows => { if (!cancelled) setVideoCount(rows.length); })
      .catch(() => { if (!cancelled) setVideoCount(null); });
    return () => { cancelled = true; };
  }, [videoOpen]);
  const select = (model: string, process = '') => {
    const next = new URLSearchParams();
    if (model) next.set('model', model);
    if (process) next.set('process', process);
    setParams(next, { replace: true });
  };
  const process = processes.find(row => row.id === processId && row.parentId);
  const processName = process ? `${shortName(processes.find(row => row.id === process.parentId))} › ${shortName(process)}` : '';
  const modelCode = overview?.modelCode ?? candidates.find(row => row.modelCodeKey === modelCodeKey)?.modelCode ?? modelCodeKey;
  const selected = overview?.processes.find(row => row.processId === processId);
  const fix = (item: ProcedureManualOverviewItemDto) => { if (!checkAccess()) return; navigate(kioskAssemblyProcedureDocumentEditPath(item.draftRevision?.documentId ?? item.documentId), {
    state: { returnTo: kioskAssemblyManualsWorkshopPath({ model: modelCodeKey, process: processId }),
      context: { modelCode, modelCodeKey, processId, processName, mode: 'fix' } }
  }); };
  const remove = async (item: ProcedureManualOverviewItemDto, deleteDocument = false) => {
    if (!checkAccess()) return;
    setBusy(true); setError(null); setOperationMessage(null);
    let unassigned = false;
    try {
      // Preserve root references, labels and unavailable entries from the existing contract.
      const detail = await getProcedureManualAssignments(modelCodeKey, processId);
      if (!detail.assignments.some(row => row.id === item.assignmentId)) {
        setVersion(value => value + 1);
        setOperationMessage('割り当てが更新されました。もう一度確認してください');
        return;
      }
      if (!checkAccess()) return;
      await replaceProcedureManualAssignments(modelCodeKey, processId, {
        modelCode, assignments: detail.assignments.filter(row => row.id !== item.assignmentId).map((row, sortOrder) => ({
          kioskDocumentId: row.kioskDocumentId, assemblyProcedureDocumentId: row.assemblyProcedureDocumentId, label: row.label, sortOrder
        }))
      });
      unassigned = true;
      if (deleteDocument && checkAccess()) await deleteAssemblyProcedureDocument(item.documentId);
      setVersion(value => value + 1);
    } catch (e) {
      if (unassigned && deleteDocument) {
        setVersion(value => value + 1);
        setOperationMessage(`${readAssemblyApiErrorMessage(e, '削除できません')}。文書は未割り当てのまま残っています。`);
      } else setError(readAssemblyApiErrorMessage(e, '割り当てを外せません'));
    }
    finally { setBusy(false); }
  };
  return <div className="grid min-h-0 flex-1 grid-rows-[64px_minmax(0,1fr)] bg-[#0f1317] text-[#eef3f6]" data-testid="procedure-manuals-workshop">
    <header aria-hidden={!accessGranted ? true : undefined} {...(!accessGranted ? { inert: '' } : {})} className="flex items-center gap-4 border-b border-[#27313b] bg-[#161c22] px-5">
      <h1 className="text-[26px] font-black tracking-widest">要領書</h1>
      <span className="inline-flex h-10 items-center gap-2 rounded-full bg-[#f6b93b29] px-3.5 text-[19px] font-bold text-[#f6b93b]"><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>作る・直す</span>
      <div className="ml-auto flex gap-4">
        <button className={`${action} !min-h-11 gap-2 text-[19px]`} onClick={() => setMaterialOpen(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>素材 {materialCount ?? '—'}{materialCount === 500 ? '+' : ''}</button>
        <button className={`${action} !min-h-11 gap-2 text-[19px]`} onClick={() => setVideoOpen(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>動画 {videoCount ?? '—'}{videoCount === 100 ? '+' : ''}</button>
        <Link to="/kiosk/assembly" className={`${action} !min-h-11 gap-2 text-[19px]`}>組立へ戻る</Link>
      </div>
    </header>
    <div className={`grid min-h-0 grid-cols-[440px_300px_minmax(0,1fr)] ${accessGranted ? '' : 'opacity-50'}`} aria-hidden={!accessGranted ? true : undefined} {...(!accessGranted ? { inert: '' } : {})}>
      <section aria-label="機種一覧" className="flex min-h-0 flex-col gap-2.5 overflow-auto border-r border-[#27313b] bg-[#161c22] p-4">
        <h2 className="text-base font-bold tracking-widest text-[#9fadb9]">機種</h2>
        <Input type="search" aria-label="機種検索" placeholder="型番で検索" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} className="h-12 shrink-0 text-[21px]" />
        <output aria-label="数字検索" className="text-xl">{digitQuery}</output>
        <ProcedureManualModelTenkey value={digitQuery} onChange={setDigitQuery} />
        {searchLoading ? <p role="status">検索中…</p> : searchError ? <p role="alert" className="text-red-400">{searchError}</p> : candidates.length === 0 ? <p className="text-[#9fadb9]">該当する機種がありません</p> : null}
        {candidates.map(row => <button key={row.modelCodeKey} aria-label={row.modelCodeKey} aria-current={row.modelCodeKey === modelCodeKey ? 'true' : undefined} className={`min-h-12 shrink-0 rounded-lg px-3 text-left font-mono text-xl font-bold break-all ${row.modelCodeKey === modelCodeKey ? 'bg-[#27313b]' : 'hover:bg-[#27313b]'}`} onClick={() => select(row.modelCodeKey)}><ProcedureManualModelMatch code={row.modelCodeKey} search={digitQuery || procedureManualModelKey(search)} /></button>)}
        {hasMore ? <p className="text-[#9fadb9]">数字を追加</p> : null}
      </section>
      <section aria-label="工程一覧" className="flex min-h-0 flex-col gap-2.5 overflow-auto border-r border-[#27313b] bg-[#161c22] p-4">
        <h2 className="text-base font-bold tracking-widest text-[#9fadb9]">工程</h2>
        {overview?.processes.map(row => {
          const child = processes.find(p => p.id === row.processId);
          return <button key={row.processId} aria-current={processId === row.processId ? 'true' : undefined} className={`flex min-h-12 shrink-0 items-center rounded-lg px-3 text-left text-[21px] font-bold ${processId === row.processId ? 'bg-[#27313b]' : 'hover:bg-[#27313b]'}`} onClick={() => select(modelCodeKey, row.processId)}>
            {shortName(processes.find(p => p.id === child?.parentId))} › {shortName(child)}<span className="ml-auto pl-2 font-mono text-[17px] font-normal text-[#9fadb9]">{row.count || '—'}</span>
          </button>;
        })}
      </section>
      <section aria-label="要領書の札" className="grid min-h-0 min-w-0 content-start gap-3.5 overflow-auto px-5 py-4">
        {!modelCodeKey ? <p className="text-[#9fadb9]">機種を選択</p> : !process ? <p className="text-[#9fadb9]">工程を選択</p> : <>
          <div className="flex min-h-12 items-center gap-3.5"><h2 className="min-w-0 text-2xl font-black break-all">{modelCodeKey} › {processName}</h2><button className={`${yellowAction} ml-auto shrink-0`} disabled={busy} onClick={() => { if (checkAccess()) setBlankOpen(true); }}><svg aria-hidden="true" className="mr-2 h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>作る</button></div>
          {selected?.items.map(item => <article key={item.assignmentId} aria-label={item.label || item.title} className="grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-[18px] rounded-[14px] border border-[#344252] bg-[#1b222a] px-4 py-3.5">
            <ManualThumbnail url={item.thumbnailPageUrl} />
            <div className="grid min-w-0 gap-2"><h3 className="truncate text-2xl font-black" title={item.label || item.title}>{item.label || item.title}</h3>
              <div className="flex flex-wrap items-center gap-2.5 text-lg text-[#9fadb9]">
                <span className={`${badge} ${item.status === 'published' ? 'border-[#3ba776] text-[#3ba776]' : item.status === 'draft' ? 'border-[#f6b93b] text-[#f6b93b]' : 'border-red-400 text-red-400'}`}>
                  {item.status === 'published' ? item.publishedRevisionNumber == null ? '公開' : `公開 第${item.publishedRevisionNumber}版` : item.status === 'draft' ? '下書き' : '無効'}
                </span>
                {item.draftRevision ? <span className={`${badge} border-[#f6b93b] bg-[#f6b93b1f] text-[#f6b93b]`}>改版中{item.draftRevision.editLease ? ` · ${item.draftRevision.editLease.holderLabel} ${new Date(item.draftRevision.editLease.acquiredAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}〜` : ''}</span> : null}
                {item.pageCount != null ? <span>{item.pageCount} ページ</span> : null}
              </div>
            </div>
            <div className="flex gap-2">
              {item.kind === 'assembly_procedure_document' && item.status !== 'unavailable' ? <button className={yellowAction} disabled={busy} onClick={() => fix(item)}><svg aria-hidden="true" className="mr-2 h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>直す</button> : null}
              {item.kind === 'assembly_procedure_document' && item.status === 'published' ? <Link className={action} to={kioskAssemblyTemplateNewPath({ procedureDocumentId: item.documentId })}>使う</Link> : null}
              <button className={`${action} border-transparent text-[#9fadb9]`} disabled={busy} onClick={() => { if (checkAccess()) setRemoving(item); }}>外す</button>
              {item.kind === 'assembly_procedure_document' && item.status === 'draft' && !item.draftRevision ? <button className={`${action} border-transparent text-[#9fadb9]`} disabled={busy} onClick={() => { if (checkAccess()) setDeleting(item); }}>削除</button> : null}
            </div>
          </article>)}
          <button className="min-h-12 rounded-[14px] border border-dashed border-[#344252] p-7 text-[22px] font-bold text-[#9fadb9] disabled:opacity-40" disabled={busy || overviewLoading || !selected} onClick={() => { if (checkAccess()) setAssignmentOpen(true); }}>＋ 既存の要領書を割り当てる</button>
        </>}
        {overviewLoading ? <p role="status" className="text-[#9fadb9]">読込中…</p> : null}
        {error ? <p role="alert" className="text-red-400">{error}</p> : null}
        {operationMessage ? <p role="alert" className="text-amber-300">{operationMessage}</p> : null}
      </section>
    </div>
    {!accessGranted ? <KioskPinDialog validHours={PROCEDURE_EDITOR_ACCESS_HOURS} backLabel="見るへ戻る" onBack={() => navigate(kioskAssemblyManualsPath())} onSubmit={async pin => {
      let result;
      try { result = await verifyAssemblyTemplateAccessPassword({ password: pin }); }
      catch (error) { return kioskPinErrorResult(error); }
      if (!result.success) return false;
      saveProcedureEditorAccess(pin);
      setAccessGranted(true);
      return true;
    }} /> : null}
    {accessGranted && blankOpen ? <ProcedureManualBlankDialog beforeMutation={checkAccess} models={models} processes={processes} modelCode={modelCode} processId={processId} onClose={() => setBlankOpen(false)} /> : null}
    {accessGranted && assignmentOpen ? <ProcedureManualAssignmentDialog beforeMutation={checkAccess} modelCode={modelCode} processId={processId} processes={processes} onClose={() => setAssignmentOpen(false)} onSaved={(key, id) => { setAssignmentOpen(false); select(key, id); setVersion(value => value + 1); }} /> : null}
    {accessGranted && materialOpen ? <ProcedureMaterialShelfDialog onClose={() => setMaterialOpen(false)} /> : null}
    {accessGranted && videoOpen ? <ProcedureVideoShelfDialog onClose={() => setVideoOpen(false)} /> : null}
    <ConfirmDialog isOpen={accessGranted && Boolean(removing)} title="割り当てを外す" description={removing?.label || removing?.title} confirmLabel="外す" buttonClassName="min-h-11" onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) void remove(removing); setRemoving(null); }} />
    <ConfirmDialog isOpen={accessGranted && Boolean(deleting)} title="要領書を削除" description="割り当てを外して削除します。元に戻せません" confirmLabel="削除" tone="danger" buttonClassName="min-h-11" onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting, true); setDeleting(null); }} />
  </div>;
}
