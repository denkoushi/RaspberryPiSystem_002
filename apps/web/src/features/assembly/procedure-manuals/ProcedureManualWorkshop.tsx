import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { deleteAssemblyProcedureDocument, getProcedureManualAssignments, getProcedureManualModelOverview, listAssemblyMachineNameCandidates, listProcedureManualModels, listProcedureManualProcesses, listProcedureMaterials, listProcedureVideos, replaceProcedureManualAssignments } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Input } from '../../../components/ui/Input';
import { useProtectedImageBlobUrl } from '../../../hooks/useProtectedImageBlobUrl';
import { kioskAssemblyManualsWorkshopPath, kioskAssemblyProcedureDocumentEditPath, kioskAssemblyTemplateNewPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ProcedureManualAssignmentDialog, procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualBlankDialog } from './ProcedureManualBlankDialog';
import { ProcedureManualModelMatch, ProcedureManualModelTenkey } from './ProcedureManualModelSearch';
import { ProcedureMaterialShelfDialog } from './ProcedureMaterialShelfDialog';
import { ProcedureVideoShelfDialog } from './ProcedureVideoShelfDialog';

import type { ProcedureManualModelDto, ProcedureManualModelOverviewDto, ProcedureManualOverviewItemDto, ProcedureManualProcessDto } from '../types';

const action = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-[#344252] px-4 text-xl font-bold disabled:opacity-40';
const yellowAction = `${action} border-[#f6b93b] bg-[#f6b93b] text-[#0b1a12]`;
const badge = 'inline-flex h-[30px] w-max items-center rounded-full border px-2.5 text-base font-bold';
const symbolAction = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#9fadb9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] disabled:opacity-40';
const statusFilters = ['全て', '公開', '下書き', '改版中'] as const;
const shortName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';

function ManualThumbnailImage({ url }: { url: string }) {
  const { blobUrl } = useProtectedImageBlobUrl(url);
  return blobUrl ? <img src={blobUrl} alt="1ページ目" className="h-full w-full object-contain" /> : null;
}

function ManualThumbnail({ url }: { url: string | null }) {
  const thumbnailRef = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (requested || !url) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setRequested(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    if (thumbnailRef.current) observer.observe(thumbnailRef.current);
    return () => observer.disconnect();
  }, [requested, url]);
  return <div ref={thumbnailRef} className="h-[26px] w-9 overflow-hidden rounded-[3px] border border-[#777] bg-white">
    {requested && url ? <ManualThumbnailImage url={url} /> : null}
  </div>;
}

export function ProcedureManualWorkshop() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const modelCodeKey = procedureManualModelKey(params.get('model') ?? '');
  const processId = params.get('process') ?? '';
  const [search, setSearch] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<typeof statusFilters[number]>('全て');
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
  const normalizedNameFilter = nameFilter.normalize('NFKC').trim().toLocaleLowerCase();
  const filteredItems = selected?.items.filter(item => {
    const matchesStatus = statusFilter === '全て'
      || (statusFilter === '公開' && item.status === 'published')
      || (statusFilter === '下書き' && item.status === 'draft' && !item.draftRevision)
      || (statusFilter === '改版中' && Boolean(item.draftRevision));
    return matchesStatus && (item.label || item.title).normalize('NFKC').toLocaleLowerCase().includes(normalizedNameFilter);
  }) ?? [];
  const fix = (item: ProcedureManualOverviewItemDto) => navigate(kioskAssemblyProcedureDocumentEditPath(item.draftRevision?.documentId ?? item.documentId), {
    state: { returnTo: kioskAssemblyManualsWorkshopPath({ model: modelCodeKey, process: processId }),
      context: { modelCode, modelCodeKey, processId, processName, mode: 'fix' } }
  });
  const remove = async (item: ProcedureManualOverviewItemDto, deleteDocument = false) => {
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
      await replaceProcedureManualAssignments(modelCodeKey, processId, {
        modelCode, assignments: detail.assignments.filter(row => row.id !== item.assignmentId).map((row, sortOrder) => ({
          kioskDocumentId: row.kioskDocumentId, assemblyProcedureDocumentId: row.assemblyProcedureDocumentId, label: row.label, sortOrder
        }))
      });
      unassigned = true;
      if (deleteDocument) await deleteAssemblyProcedureDocument(item.documentId);
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
    <header className="flex items-center gap-4 border-b border-[#27313b] bg-[#161c22] px-5">
      <h1 className="text-[26px] font-black tracking-widest">要領書</h1>
      <span className="inline-flex h-10 items-center gap-2 rounded-full bg-[#f6b93b29] px-3.5 text-[19px] font-bold text-[#f6b93b]"><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>作る・直す</span>
      <div className="ml-auto flex gap-4">
        <button className={`${action} !min-h-11 gap-2 text-[19px]`} onClick={() => setMaterialOpen(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>素材 {materialCount ?? '—'}{materialCount === 500 ? '+' : ''}</button>
        <button className={`${action} !min-h-11 gap-2 text-[19px]`} onClick={() => setVideoOpen(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>動画 {videoCount ?? '—'}{videoCount === 100 ? '+' : ''}</button>
        <Link to="/kiosk/assembly" className={`${action} !min-h-11 gap-2 text-[19px]`}>組立へ戻る</Link>
      </div>
    </header>
    <div className="grid min-h-0 grid-cols-[440px_300px_minmax(0,1fr)]">
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
      <section aria-label="要領書一覧" className="grid min-h-0 min-w-0 content-start overflow-auto px-4 py-3">
        {!modelCodeKey ? <p className="text-[#9fadb9]">機種を選択</p> : !process ? <p className="text-[#9fadb9]">工程を選択</p> : <>
          <div className="mb-1.5 flex min-h-[52px] min-w-max items-center gap-3">
            <h2 className="text-[22px] font-black">{processName}</h2>
            <span className="font-mono text-lg text-[#9fadb9]">{filteredItems.length} 件</span>
            <div className="ml-3 flex gap-1.5" role="group" aria-label="状態で絞り込み">
              {statusFilters.map(filter => <button key={filter} aria-pressed={statusFilter === filter} className={`h-11 rounded-full border border-[#344252] px-3 text-[17px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] ${statusFilter === filter ? 'bg-[#27313b] text-[#eef3f6]' : 'text-[#9fadb9]'}`} onClick={() => setStatusFilter(filter)}>{filter}</button>)}
            </div>
            <input type="search" aria-label="名前で絞り込み" placeholder="名前で絞り込み" value={nameFilter} onChange={event => setNameFilter(event.target.value)} className="h-11 w-[260px] rounded-lg border border-[#344252] bg-white px-3 text-lg text-[#0f1317] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff]" />
            <button className={`${yellowAction} ml-auto shrink-0`} disabled={busy} onClick={() => setBlankOpen(true)}><svg aria-hidden="true" className="mr-2 h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>作る</button>
          </div>
          <div role="table" aria-label={processName} className="min-w-[840px]">
          <div role="row" className="sr-only">
            {['サムネイル', '名前', '状態', '担当・承認', 'ページ', '操作'].map(label => <div role="columnheader" key={label}>{label}</div>)}
          </div>
          {filteredItems.map(item => <div role="row" key={item.assignmentId} aria-label={item.label || item.title} className="grid h-14 grid-cols-[36px_minmax(0,1fr)_160px_150px_90px_140px] items-center gap-3 border-b border-[#27313b] px-2.5 hover:bg-[#1b222a]">
            <div role="cell"><ManualThumbnail url={item.thumbnailPageUrl} /></div>
            <div role="cell" className="truncate font-mono text-xl font-bold" title={item.label || item.title}>{item.label || item.title}</div>
            <div role="cell">
                <span className={`${badge} ${item.status === 'published' ? 'border-[#3ba776] text-[#3ba776]' : item.status === 'draft' ? 'border-[#f6b93b] text-[#f6b93b]' : 'border-[#e5484d] text-[#e5484d]'}`}>
                  {item.status === 'published' ? item.publishedRevisionNumber == null ? '公開' : `公開 第${item.publishedRevisionNumber}版` : item.status === 'draft' ? '下書き' : '無効'}
                </span>
            </div>
            <div role="cell" className="truncate text-base text-[#9fadb9]">
              {item.draftRevision ? <span className="rounded-full bg-[#f6b93b1f] px-2.5 py-1 text-[#f6b93b]">改版中{item.draftRevision.editLease ? ` · ${item.draftRevision.editLease.holderLabel} ${new Date(item.draftRevision.editLease.acquiredAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}〜` : ''}</span> : item.approval ? `承認 ${item.approval.employeeName} ${new Date(item.approval.approvedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}` : null}
            </div>
            <div role="cell" className="text-right font-mono text-base text-[#9fadb9]">{item.pageCount ?? '—'}{item.pageCount != null ? <span className="sr-only"> ページ</span> : null}</div>
            <div role="cell" className="flex gap-1">
              {item.kind === 'assembly_procedure_document' && item.status !== 'unavailable' ? <button aria-label="直す" title="直す" className={`${symbolAction} !border-[#f6b93b] !text-[#f6b93b]`} disabled={busy} onClick={() => fix(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg></button> : null}
              {item.kind === 'assembly_procedure_document' && item.status === 'published' ? <Link aria-label="使う" title="使う" className={symbolAction} to={kioskAssemblyTemplateNewPath({ procedureDocumentId: item.documentId })}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg></Link> : null}
              <button aria-label="外す" title="外す" className={symbolAction} disabled={busy} onClick={() => setRemoving(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg></button>
              {item.kind === 'assembly_procedure_document' && item.status === 'draft' && !item.draftRevision ? <button aria-label="削除" title="削除" className={symbolAction} disabled={busy} onClick={() => setDeleting(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg></button> : null}
            </div>
          </div>)}
          </div>
          <button className="mt-2.5 min-h-12 rounded-[10px] border border-dashed border-[#344252] text-lg text-[#9fadb9] disabled:opacity-40" disabled={busy || overviewLoading || !selected} onClick={() => setAssignmentOpen(true)}>＋ 既存の要領書を割り当てる</button>
        </>}
        {overviewLoading ? <p role="status" className="text-[#9fadb9]">読込中…</p> : null}
        {error ? <p role="alert" className="text-red-400">{error}</p> : null}
        {operationMessage ? <p role="alert" className="text-amber-300">{operationMessage}</p> : null}
      </section>
    </div>
    {blankOpen ? <ProcedureManualBlankDialog models={models} processes={processes} modelCode={modelCode} processId={processId} onClose={() => setBlankOpen(false)} /> : null}
    {assignmentOpen ? <ProcedureManualAssignmentDialog modelCode={modelCode} processId={processId} processes={processes} onClose={() => setAssignmentOpen(false)} onSaved={(key, id) => { setAssignmentOpen(false); select(key, id); setVersion(value => value + 1); }} /> : null}
    {materialOpen ? <ProcedureMaterialShelfDialog onClose={() => setMaterialOpen(false)} /> : null}
    {videoOpen ? <ProcedureVideoShelfDialog onClose={() => setVideoOpen(false)} /> : null}
    <ConfirmDialog isOpen={Boolean(removing)} title="割り当てを外す" description={removing?.label || removing?.title} confirmLabel="外す" buttonClassName="min-h-11" onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) void remove(removing); setRemoving(null); }} />
    <ConfirmDialog isOpen={Boolean(deleting)} title="要領書を削除" description="割り当てを外して削除します。元に戻せません" confirmLabel="削除" tone="danger" buttonClassName="min-h-11" onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting, true); setDeleting(null); }} />
  </div>;
}
