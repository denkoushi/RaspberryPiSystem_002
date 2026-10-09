import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { deleteAssemblyProcedureDocument, verifyAssemblyTemplateAccessPassword, getProcedureManualAssignments, getProcedureManualOverview, getAssemblyProcedureDocument, listAssemblyMachineNameCandidates, listProcedureManualPartCandidates, listProcedureManualModels, listProcedureManualProcesses, listProcedureMaterials, listProcedureVideos, replaceProcedureManualAssignments } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Dialog } from '../../../components/ui/Dialog';
import { IconActionTooltip } from '../../../components/ui/IconActionTooltip';
import { normalizeWorkInstructionPartNumber } from '../../../lib/workInstructionRules';
import { KioskPinDialog, kioskPinErrorResult } from '../../kiosk/KioskPinDialog';
import { AssemblyProcedurePreviewDialog } from '../AssemblyProcedurePreviewDialog';
import { AssemblyProcedureSequenceViewer } from '../AssemblyProcedureSequenceViewer';
import { kioskAssemblyManualsPath, kioskAssemblyManualsWorkshopPath, kioskAssemblyProcedureDocumentEditPath, kioskAssemblyTemplateNewPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';
import { PROCEDURE_EDITOR_ACCESS_HOURS, readProcedureEditorAccess, saveProcedureEditorAccess, subscribeProcedureEditorAccess } from '../procedureEditorAccess';

import { ManualThumbnail } from './ManualThumbnail';
import { procedureManualButtonBase, procedureManualButtonSelected, procedureManualButtonUnselected } from './procedure-manual-button-styles';
import { ProcedureManualAssignmentDialog, procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualBlankDialog } from './ProcedureManualBlankDialog';
import { ProcedureManualFilterPane } from './ProcedureManualFilterPane';
import { ProcedureMaterialShelfDialog } from './ProcedureMaterialShelfDialog';
import { ProcedureVideoShelfDialog } from './ProcedureVideoShelfDialog';

import type { ProcedureManualPartCandidateDto } from '../../../api/client';
import type { ProcedureManualModelDto, AssemblyProcedureDocumentDto, AssemblyProcedureSequenceDto, ProcedureManualAssignmentOverviewItemDto, ProcedureManualOverviewItemDto, ProcedureManualProcessDto } from '../types';

const action = `${procedureManualButtonBase} ${procedureManualButtonUnselected} inline-flex items-center justify-center px-4 text-xl font-bold disabled:opacity-40`;
const primaryAction = `${procedureManualButtonBase} inline-flex items-center justify-center px-4 text-xl font-bold disabled:opacity-40 border-[#3ba776] bg-[#3ba776] text-[#0b1a12]`;
const badge = 'inline-flex h-[30px] w-max items-center rounded-full border px-2.5 text-base font-bold';
const symbolAction = 'inline-flex min-h-12 w-11 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#9fadb9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] disabled:opacity-40';
const statusFilters = ['全て', '公開', '下書き', '改版中'] as const;
const usageLabel = (assignments: ProcedureManualOverviewItemDto['otherAssignments']) => assignments.map(row => `${row.modelCode} · ${row.processName}`).join('、');
const canDelete = (item: ProcedureManualOverviewItemDto) => item.kind === 'assembly_procedure_document' && item.status === 'draft' && !item.draftRevision && item.otherAssignments.length === 0;
const shortName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';

export function ProcedureManualWorkshop() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const modelCodeKey = params.has('part') ? normalizeWorkInstructionPartNumber(params.get('part')) : procedureManualModelKey(params.get('model') ?? '');
  const processId = params.get('process') ?? '';
  const [search, setSearch] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<typeof statusFilters[number]>('全て');
  const [digitQuery, setDigitQuery] = useState('');
  const [models, setModels] = useState<ProcedureManualModelDto[]>([]);
  const [partCandidates, setPartCandidates] = useState<ProcedureManualPartCandidateDto[]>([]);
  const [candidates, setCandidates] = useState<ProcedureManualModelDto[]>([]);
  const [processes, setProcesses] = useState<ProcedureManualProcessDto[]>([]);
  const [allKind, setAllKind] = useState<'MODEL' | 'PART'>(() => params.has('part') ? 'PART' : 'MODEL');
  const subjectKind = processes.find(row => row.id === processId)?.subjectKind ?? allKind;
  const [items, setItems] = useState<ProcedureManualAssignmentOverviewItemDto[]>([]);
  const [preview, setPreview] = useState<AssemblyProcedureDocumentDto | null>(null);
  const [previewSequence, setPreviewSequence] = useState<AssemblyProcedureSequenceDto | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
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
  const [removing, setRemoving] = useState<ProcedureManualAssignmentOverviewItemDto | null>(null);
  const [deleting, setDeleting] = useState<ProcedureManualAssignmentOverviewItemDto | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);
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
  useEffect(() => {
    let cancelled = false;
    void listProcedureManualProcesses().then(rows => { if (!cancelled) setProcesses(rows); })
      .catch(e => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '工程を取得できません')); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const sequence = ++requestSequence.current;
    setSearchLoading(true); setSearchError(null); setCandidates([]); setPartCandidates([]); setHasMore(false);
    const load = subjectKind === 'PART'
      ? listProcedureManualPartCandidates({ digitQuery, q: search, limit: 30 }).then(rows => {
        if (sequence === requestSequence.current) setPartCandidates(rows);
      })
      : search || digitQuery
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
    void load.catch(e => { if (sequence === requestSequence.current) setSearchError(readAssemblyApiErrorMessage(e, `${subjectKind === 'PART' ? '部品' : '機種'}を検索できません`)); })
      .finally(() => { if (sequence === requestSequence.current) setSearchLoading(false); });
    return () => { requestSequence.current += 1; };
  }, [search, digitQuery, version, subjectKind]);
  useEffect(() => {
    let cancelled = false;
    setItems([]); setError(null); setOverviewLoading(true);
    void getProcedureManualOverview().then(next => { if (!cancelled) setItems(next.processes.flatMap(row => row.items)); })
      .catch(e => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '要領書を取得できません')); })
      .finally(() => { if (!cancelled) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, [version]);
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
  const select = (model: string, process = '', selectedKind?: 'MODEL' | 'PART') => {
    const next = new URLSearchParams();
    const kind = selectedKind ?? processes.find(row => row.id === process)?.subjectKind ?? subjectKind;
    setAllKind(kind);
    if (model) next.set(kind === 'PART' ? 'part' : 'model', model);
    if (process) next.set('process', process);
    setParams(next, { replace: true });
  };
  const selectProcess = (id: string) => {
    if (!id && !processId) return;
    const kind = processes.find(row => row.id === id)?.subjectKind ?? 'MODEL';
    if (kind !== subjectKind) { setSearch(''); setDigitQuery(''); }
    select(kind === subjectKind ? modelCodeKey : '', id, kind);
  };
  const process = processes.find(row => row.id === processId && row.parentId);
  const modelCode = items.find(row => row.modelCodeKey === modelCodeKey)?.modelCode ?? candidates.find(row => row.modelCodeKey === modelCodeKey)?.modelCode ?? modelCodeKey;
  const normalizedNameFilter = nameFilter.normalize('NFKC').trim().toLocaleLowerCase();
  const filteredItems = items.filter(item => {
    const matchesStatus = statusFilter === '全て'
      || (statusFilter === '公開' && item.status === 'published')
      || (statusFilter === '下書き' && item.status === 'draft' && !item.draftRevision)
      || (statusFilter === '改版中' && Boolean(item.draftRevision));
    return (!modelCodeKey || item.modelCodeKey === modelCodeKey) && (!processId || item.processId === processId) && (!modelCodeKey || (processes.find(row => row.id === item.processId)?.subjectKind ?? 'MODEL') === subjectKind) && matchesStatus && (item.label || item.title).normalize('NFKC').toLocaleLowerCase().includes(normalizedNameFilter);
  });
  const rowProcessName = (item: ProcedureManualAssignmentOverviewItemDto) => {
    const child = processes.find(row => row.id === item.processId);
    return `${shortName(processes.find(row => row.id === child?.parentId))} › ${shortName(child)}`;
  };
  const openEditor = (item: ProcedureManualAssignmentOverviewItemDto) => navigate(kioskAssemblyProcedureDocumentEditPath(item.draftRevision?.documentId ?? item.documentId), {
    state: { returnTo: kioskAssemblyManualsWorkshopPath({ [subjectKind === 'PART' ? 'part' : 'model']: modelCodeKey, process: processId }),
      context: { modelCode: item.modelCode, modelCodeKey: item.modelCodeKey, processId: item.processId, processName: rowProcessName(item), mode: 'fix' } }
  });
  const fix = (item: ProcedureManualAssignmentOverviewItemDto) => { if (checkAccess()) openEditor(item); };
  const view = async (item: ProcedureManualAssignmentOverviewItemDto) => {
    setPreviewLoading(true); setError(null);
    try {
      if (item.kind === 'assembly_procedure_document') {
        setPreview(await getAssemblyProcedureDocument(item.documentId));
      } else {
        const detail = await getProcedureManualAssignments(item.modelCodeKey, item.processId);
        const documents = detail.sequence.documents.filter(row => row.kioskDocumentId === item.documentId);
        if (!documents.length) throw new Error('文書を表示できません');
        setPreviewTitle(item.label || item.title);
        setPreviewSequence({ ...detail.sequence, documents, steps: detail.sequence.steps?.filter(row => row.kioskDocumentId === item.documentId) });
      }
    } catch (cause) { setError(readAssemblyApiErrorMessage(cause, '文書を表示できません')); }
    finally { setPreviewLoading(false); }
  };
  const remove = async (item: ProcedureManualAssignmentOverviewItemDto, deleteDocument = false) => {
    if (!checkAccess()) return;
    setBusy(true); setError(null); setOperationMessage(null);
    let unassigned = false;
    try {
      // Preserve root references, labels and unavailable entries from the existing contract.
      const detail = await getProcedureManualAssignments(item.modelCodeKey, item.processId);
      if (!detail.assignments.some(row => row.id === item.assignmentId)) {
        setVersion(value => value + 1);
        setOperationMessage('割り当てが更新されました。もう一度確認してください');
        return;
      }
      await replaceProcedureManualAssignments(item.modelCodeKey, item.processId, {
        modelCode: item.modelCode, assignments: detail.assignments.filter(row => row.id !== item.assignmentId).map((row, sortOrder) => ({
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
    <header className="flex items-center gap-4 border-b border-[#27313b] bg-[#161c22] px-5">
      <h1 className="text-[26px] font-black tracking-widest">要領書</h1>
      <span className="inline-flex h-10 items-center gap-2 rounded-full bg-[#f6b93b29] px-3.5 text-[19px] font-bold text-[#f6b93b]"><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>作る・直す</span>
      <div className="ml-auto flex gap-4">
        <button className={`${action} gap-2 text-[19px]`} onClick={() => setMaterialOpen(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>素材 {materialCount ?? '—'}{materialCount === 500 ? '+' : ''}</button>
        <button className={`${action} gap-2 text-[19px]`} onClick={() => setVideoOpen(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>動画 {videoCount ?? '—'}{videoCount === 100 ? '+' : ''}</button>
        <Link to="/kiosk/assembly" className={`${action} gap-2 text-[19px]`}>組立へ戻る</Link>
      </div>
    </header>
    <div className="grid min-h-0 grid-cols-[460px_minmax(0,1fr)]">
      <ProcedureManualFilterPane allowKindChangeWithProcess subjectKind={subjectKind} onKindChange={kind => { if (kind !== subjectKind) { setSearch(''); setDigitQuery(''); select('', '', kind); } }} processes={processes} items={items} models={candidates} partSearchCandidates={partCandidates} modelCodeKey={modelCodeKey} processId={processId}
        search={search} digitQuery={digitQuery} onSearchChange={setSearch} onDigitQueryChange={setDigitQuery}
        onModelSelect={key => select(key === modelCodeKey ? '' : key, processId)} onProcessSelect={selectProcess}
        loading={searchLoading} error={searchError} hasMore={hasMore} />
      <section aria-label="要領書一覧" className="grid min-h-0 min-w-0 content-start overflow-auto px-4 py-3">
        <>
          <div className="mb-1.5 flex min-h-[52px] min-w-max items-center gap-3">
            <h2 aria-label={`${modelCodeKey || (subjectKind === 'PART' ? '全部品' : '全機種')} › ${process ? shortName(process) : '全工程'}`} className="flex items-center gap-2 text-[22px] font-black">
              <span className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[#344252] pl-3 ${modelCodeKey ? '' : 'border-dashed pr-3 text-[#9fadb9]'}`}>
                {modelCodeKey || (subjectKind === 'PART' ? '全部品' : '全機種')}{modelCodeKey ? <IconActionTooltip label={`${subjectKind === 'PART' ? '部品' : '機種'}の絞り込みを外す`}><button aria-label={`${subjectKind === 'PART' ? '部品' : '機種'}の絞り込みを外す`} className={symbolAction} onClick={() => select('', processId)}>×</button></IconActionTooltip> : null}
              </span> ›
              <span className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[#344252] pl-3 ${process ? '' : 'border-dashed pr-3 text-[#9fadb9]'}`}>
                {process ? shortName(process) : '全工程'}{process ? <IconActionTooltip label="工程の絞り込みを外す"><button aria-label="工程の絞り込みを外す" className={symbolAction} onClick={() => selectProcess('')}>×</button></IconActionTooltip> : null}
              </span>
            </h2>
            <span className="font-mono text-lg text-[#9fadb9]">{filteredItems.length} 件</span>
            <div className="ml-3 flex gap-1.5" role="group" aria-label="状態で絞り込み">
              {statusFilters.map(filter => <button key={filter} aria-pressed={statusFilter === filter} className={`${procedureManualButtonBase} px-3 text-[17px] font-bold ${statusFilter === filter ? procedureManualButtonSelected : `${procedureManualButtonUnselected} text-[#9fadb9]`}`} onClick={() => setStatusFilter(filter)}>{filter}</button>)}
            </div>
            <input type="search" aria-label="名前で絞り込み" placeholder="名前で絞り込み" value={nameFilter} onChange={event => setNameFilter(event.target.value)} className="h-11 w-[260px] rounded-lg border border-[#344252] bg-white px-3 text-lg text-[#0f1317] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff]" />
            <button className={`${primaryAction} ml-auto shrink-0`} disabled={busy} onClick={() => { if (checkAccess()) setBlankOpen(true); }}><svg aria-hidden="true" className="mr-2 h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>作る</button>
          </div>
          <div role="table" aria-label={process ? shortName(process) : '全工程'} className="min-w-[1100px]">
          <div role="row" className="sr-only">
            {['サムネイル', '名前', ...(!modelCodeKey ? ['機種・部品'] : []), ...(!processId ? ['工程'] : []), '状態', '他の使用先', '担当・承認', 'ページ', '操作'].map(label => <div role="columnheader" key={label}>{label}</div>)}
          </div>
          {filteredItems.map(item => <div role="row" key={item.assignmentId} aria-label={item.label || item.title} style={{ gridTemplateColumns: `36px minmax(220px,1fr) ${!modelCodeKey ? '160px ' : ''}${!processId ? '90px ' : ''}150px 180px 150px 50px 188px` }} className="grid h-14 items-center gap-3 border-b border-[#27313b] px-2.5 hover:bg-[#1b222a]">
            <div role="cell"><ManualThumbnail url={item.thumbnailPageUrl} /></div>
            <div role="cell" className="truncate font-mono text-xl font-bold" title={item.label || item.title}>{item.label || item.title}</div>
            {!modelCodeKey ? <div role="cell" className="truncate font-mono text-[17px] font-bold">{item.modelCode}</div> : null}
            {!processId ? <div role="cell" className="truncate text-[17px] font-bold">{shortName(processes.find(row => row.id === item.processId))}</div> : null}
            <div role="cell">
                <span className={`${badge} ${item.status === 'published' ? 'border-[#3ba776] text-[#3ba776]' : item.status === 'draft' ? 'border-[#f6b93b] text-[#f6b93b]' : 'border-[#e5484d] text-[#e5484d]'}`}>
                  {item.status === 'published' ? item.publishedRevisionNumber == null ? '公開' : `公開 第${item.publishedRevisionNumber}版` : item.status === 'draft' ? '下書き' : '無効'}
                </span>
            </div>
            <div role="cell" className="truncate text-[15px] text-[#9fadb9]">{usageLabel(item.otherAssignments) || '—'}</div>
            <div role="cell" className="truncate text-base text-[#9fadb9]">
              {item.draftRevision ? <span className="rounded-full bg-[#f6b93b1f] px-2.5 py-1 text-[#f6b93b]">改版中{item.draftRevision.editLease ? ` · ${item.draftRevision.editLease.holderLabel} ${new Date(item.draftRevision.editLease.acquiredAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}〜` : ''}</span> : item.approval ? `承認 ${item.approval.employeeName} ${new Date(item.approval.approvedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}` : null}
            </div>
            <div role="cell" className="text-right font-mono text-base text-[#9fadb9]">{item.pageCount ?? '—'}{item.pageCount != null ? <span className="sr-only"> ページ</span> : null}</div>
            <div role="cell" className="flex gap-1">
              {item.status !== 'unavailable' ? <IconActionTooltip label="見る" disabled={previewLoading}><button aria-label="見る" className={`${symbolAction} !border-[#344252] !text-[#eef3f6]`} disabled={previewLoading} onClick={() => void view(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg></button></IconActionTooltip> : null}
              {item.kind === 'assembly_procedure_document' && item.status !== 'unavailable' ? <IconActionTooltip label="直す" disabled={busy}><button aria-label="直す" className={`${symbolAction} !border-[#3ba776] !text-[#3ba776]`} disabled={busy} onClick={() => fix(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg></button></IconActionTooltip> : null}
              {item.kind === 'assembly_procedure_document' && item.status === 'published' ? <IconActionTooltip label="使う"><Link aria-label="使う" className={symbolAction} to={kioskAssemblyTemplateNewPath({ procedureDocumentId: item.documentId })}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg></Link></IconActionTooltip> : null}
              {canDelete(item) ? <IconActionTooltip label="削除" disabled={busy}><button aria-label="削除" className={symbolAction} disabled={busy} onClick={() => { if (checkAccess()) setDeleting(item); }}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg></button></IconActionTooltip> : <IconActionTooltip label="外す" disabled={busy}><button aria-label="外す" className={symbolAction} disabled={busy} onClick={() => { if (checkAccess()) setRemoving(item); }}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg></button></IconActionTooltip>}
            </div>
          </div>)}
          </div>
          {!overviewLoading && filteredItems.length === 0 ? <p className="p-4 text-lg text-[#9fadb9]">該当する要領書がありません</p> : null}
          {modelCodeKey && process ? <button className={`${procedureManualButtonBase} ${procedureManualButtonUnselected} mt-2.5 border-dashed text-lg text-[#9fadb9] disabled:opacity-40`} disabled={busy || overviewLoading} onClick={() => { if (checkAccess()) setAssignmentOpen(true); }}>＋ 既存の要領書を割り当てる</button> : null}
        </>
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
    {accessGranted && blankOpen ? <ProcedureManualBlankDialog subjectKind={subjectKind} beforeMutation={checkAccess} models={models} processes={processes} modelCode={modelCode} processId={processId} onClose={() => setBlankOpen(false)} /> : null}
    {accessGranted && assignmentOpen ? <ProcedureManualAssignmentDialog beforeMutation={checkAccess} modelCode={modelCode} processId={processId} processes={processes} onClose={() => setAssignmentOpen(false)} onSaved={(key, id) => { setAssignmentOpen(false); select(key, id); setVersion(value => value + 1); }} /> : null}
    {materialOpen ? <ProcedureMaterialShelfDialog onClose={() => setMaterialOpen(false)} onCreatedDocument={(documentId) => {
      setMaterialOpen(false);
      navigate(kioskAssemblyProcedureDocumentEditPath(documentId), { state: { returnTo: kioskAssemblyManualsWorkshopPath({ [subjectKind === 'PART' ? 'part' : 'model']: modelCodeKey, process: processId }) } });
    }} /> : null}
    {videoOpen ? <ProcedureVideoShelfDialog onClose={() => setVideoOpen(false)} /> : null}
    <AssemblyProcedurePreviewDialog document={preview} isOpen={Boolean(preview)} onClose={() => setPreview(null)} />
    {previewSequence ? <Dialog isOpen onClose={() => setPreviewSequence(null)} title={previewTitle} size="full">
      <AssemblyProcedureSequenceViewer sequence={previewSequence} showCurrentMarkerButton={false} className="min-h-0 flex-1" />
      <button className={`${action} mt-3 self-end`} onClick={() => setPreviewSequence(null)}>閉じる</button>
    </Dialog> : null}
    <ConfirmDialog isOpen={Boolean(removing)} title="この工程から外す" description={removing ? `${removing.label || removing.title}。${removing.otherAssignments.length ? `他の使用先に残ります：${usageLabel(removing.otherAssignments)}` : '手順書一覧に「未使用」で残ります'}` : undefined} confirmLabel="外す" buttonClassName="min-h-12" onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) void remove(removing); setRemoving(null); }} />
    <ConfirmDialog isOpen={Boolean(deleting)} title="下書きを削除" description={deleting ? `${deleting.label || deleting.title}。元に戻せません` : undefined} confirmLabel="削除" tone="danger" buttonClassName="min-h-12" onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting, true); setDeleting(null); }} />
  </div>;
}
