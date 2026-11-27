import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { listProcedureManualCommon, discardAssemblyProcedureDocumentRevision, deleteAssemblyProcedureDocument, getProcedureManualAssignments, getProcedureManualOverview, getAssemblyProcedureDocument, listAssemblyMachineNameCandidates, listProcedureManualPartCandidates, listProcedureManualModels, listProcedureManualProcesses, countProcedureMaterials, countProcedureVideos, replaceProcedureManualAssignments } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { IconActionTooltip } from '../../../components/ui/IconActionTooltip';
import { normalizeWorkInstructionPartNumber } from '../../../lib/workInstructionRules';
import { kioskAssemblyManualsWorkshopPath, kioskAssemblyProcedureDocumentEditPath, kioskAssemblyTemplateNewPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';


import { procedureManualButtonBase, procedureManualButtonSelected, procedureManualButtonUnselected, procedureManualSymbolAction as symbolAction } from './procedure-manual-button-styles';
import { clearManualLists, fetchManualList, readManualList, retainEqual } from './procedure-manual-list-cache';
import { splitProcedureManualName } from './procedure-manual-name';
import { useShelfResources } from './procedure-material-shelf-search';
import { ProcedureManualAssignmentDialog, procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualBlankDialog } from './ProcedureManualBlankDialog';
import { ProcedureManualCommonDialog } from './ProcedureManualCommonDialog';
import { ProcedureManualCommonList, filterProcedureManualCommonItems } from './ProcedureManualCommonList';
import { ProcedureManualCommonRenameDialog } from './ProcedureManualCommonRenameDialog';
import { ProcedureManualFilterPane } from './ProcedureManualFilterPane';
import { ProcedureManualFullscreenPreview, procedureDocumentToSequence } from './ProcedureManualFullscreenPreview';
import { ProcedureManualReattachPartDialog } from './ProcedureManualReattachPartDialog';
import { ProcedureManualRenameDialog } from './ProcedureManualRenameDialog';
import { ProcedureMaterialShelfDialog } from './ProcedureMaterialShelfDialog';
import { ProcedureVideoShelfDialog } from './ProcedureVideoShelfDialog';

import type { ProcedureManualPartCandidateDto } from '../../../api/client';
import type { ProcedureManualCommonCatalogDto, ProcedureManualModelDto, AssemblyProcedureSequenceDto, ProcedureManualAssignmentOverviewItemDto, ProcedureManualOverviewItemDto, ProcedureManualProcessDto } from '../types';

const action = `${procedureManualButtonBase} ${procedureManualButtonUnselected} inline-flex items-center justify-center px-4 text-xl font-bold disabled:opacity-40`;
const primaryAction = `${procedureManualButtonBase} inline-flex items-center justify-center px-4 text-xl font-bold disabled:opacity-40 border-[#3ba776] bg-[#3ba776] text-[#0b1a12]`;
const badge = 'inline-flex h-[30px] w-max items-center rounded-full border px-2.5 text-base font-bold';
const statusFilters = ['全て', '公開', '下書き', '改版中'] as const;
const usageLabel = (assignments: ProcedureManualOverviewItemDto['otherAssignments']) => assignments.map(row => `${row.modelCode} · ${row.processName}`).join('、');
const canDelete = (item: ProcedureManualOverviewItemDto) => item.kind === 'assembly_procedure_document' && item.status === 'draft' && !item.draftRevision && item.otherAssignments.length === 0;
const shortName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';
const normalizeModels = (rows: ProcedureManualModelDto[]) => [...new Map(rows.map(row => {
  const code = procedureManualModelKey(row.modelCodeKey);
  return [code, { ...row, modelCodeKey: code }] as const;
})).values()].filter(row => row.modelCodeKey);

export function ProcedureManualWorkshop() {
  const shelfResources = useShelfResources();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const modelCodeKey = params.has('common') ? '' : params.has('part') ? normalizeWorkInstructionPartNumber(params.get('part')) : procedureManualModelKey(params.get('model') ?? '');
  const processId = params.get('process') ?? '';
  const [search, setSearch] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<typeof statusFilters[number]>('全て');
  const [digitQuery, setDigitQuery] = useState('');
  const [, setModels] = useState<ProcedureManualModelDto[]>(() => normalizeModels(readManualList('models') ?? []));
  const [partCandidates, setPartCandidates] = useState<ProcedureManualPartCandidateDto[]>([]);
  const [candidates, setCandidates] = useState<ProcedureManualModelDto[]>(() => normalizeModels(readManualList('models') ?? []));
  const [processes, setProcesses] = useState<ProcedureManualProcessDto[]>(() => readManualList('processes') ?? []);
  const [allKind, setAllKind] = useState<'MODEL' | 'PART' | 'COMMON'>(() => params.has('common') ? 'COMMON' : params.has('part') ? 'PART' : 'MODEL');
  const subjectKind = params.has('common') ? 'COMMON' : processes.find(row => row.id === processId)?.subjectKind ?? allKind;
  const isCommon = subjectKind === 'COMMON';
  const [kanaRow, setKanaRow] = useState('');
  const [commonCatalog, setCommonCatalog] = useState<ProcedureManualCommonCatalogDto>(() => readManualList('common') ?? { categories: [], actions: [], subjects: [] });
  const [categoryBusy, setCategoryBusy] = useState(false);
  const latestParams = useRef(params);
  useEffect(() => { latestParams.current = params; }, [params]);
  const commonReturnTo = kioskAssemblyManualsWorkshopPath({ common: '1', process: processId });
  const [items, setItems] = useState<ProcedureManualAssignmentOverviewItemDto[]>(() => readManualList('overview')?.processes.flatMap(row => row.items) ?? []);
  const [previewSequence, setPreviewSequence] = useState<AssemblyProcedureSequenceDto | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(() => !readManualList('models'));
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [blankOpen, setBlankOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [materialCount, setMaterialCount] = useState<number | null>(() => readManualList('materialCount') ?? null);
  const [videoCount, setVideoCount] = useState<number | null>(() => readManualList('videoCount') ?? null);
  const [removing, setRemoving] = useState<ProcedureManualAssignmentOverviewItemDto | null>(null);
  const [discarding, setDiscarding] = useState<ProcedureManualAssignmentOverviewItemDto | null>(null);
  const [deleting, setDeleting] = useState<ProcedureManualAssignmentOverviewItemDto | null>(null);
  const [reattaching, setReattaching] = useState<ProcedureManualAssignmentOverviewItemDto | null>(null);
  const [commonRenaming, setCommonRenaming] = useState<ProcedureManualAssignmentOverviewItemDto | null>(null);
  const [renaming, setRenaming] = useState<ProcedureManualAssignmentOverviewItemDto | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchStarted = useRef(false);
  const requestSequence = useRef(0);
  const commonSequence = useRef(0);
  const previousVersion = useRef(version);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (previousVersion.current !== version) {
      commonSequence.current += 1;
      clearManualLists({ preserveProcesses: true });
      previousVersion.current = version;
    }
  }, [version]);
  const beforeMutation = () => {
    clearManualLists();
    return true;
  };
  const clearDeletedCategory = (id: string) => {
    const current = latestParams.current;
    if (!mounted.current || !current.has('common') || current.get('process') !== id) return;
    const next = new URLSearchParams(current);
    next.delete('process');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    let cancelled = false;
    const sequence = commonSequence.current;
    void fetchManualList('processes', listProcedureManualProcesses).then(rows => {
      if (!cancelled) setProcesses(current => sequence === commonSequence.current ? rows : [...rows.filter(row => row.subjectKind !== 'COMMON'), ...current.filter(row => row.subjectKind === 'COMMON')]);
    })
      .catch(e => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '工程を取得できません')); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (subjectKind === 'COMMON') { setSearchLoading(false); setSearchError(null); return; }
    const sequence = ++requestSequence.current;
    if (searchStarted.current || search || digitQuery || subjectKind === 'PART' || !readManualList('models')) {
      setSearchLoading(true); setCandidates([]); setPartCandidates([]); setHasMore(false);
    }
    searchStarted.current = true;
    setSearchError(null);
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
      : fetchManualList('models', listProcedureManualModels).then(rows => {
        if (sequence !== requestSequence.current) return;
        const normalized = normalizeModels(rows);
        setModels(current => retainEqual(current, normalized)); setCandidates(current => retainEqual(current, normalized));
      });
    void load.catch(e => { if (sequence === requestSequence.current) setSearchError(readAssemblyApiErrorMessage(e, `${subjectKind === 'PART' ? '部品' : '機種'}を検索できません`)); })
      .finally(() => { if (sequence === requestSequence.current) setSearchLoading(false); });
    return () => { requestSequence.current += 1; };
  }, [search, digitQuery, version, subjectKind]);
  useEffect(() => {
    let cancelled = false;
    const sequence = commonSequence.current;
    if (!readManualList('overview')) { setItems([]); setOverviewLoading(true); }
    setError(null);
    void fetchManualList('overview', () => getProcedureManualOverview()).then(next => { if (!cancelled && sequence === commonSequence.current) setItems(current => retainEqual(current, next.processes.flatMap(row => row.items))); })
      .catch(e => { if (!cancelled && sequence === commonSequence.current) setError(readAssemblyApiErrorMessage(e, '要領書を取得できません')); })
      .finally(() => { if (!cancelled && sequence === commonSequence.current) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, [version]);
  const refreshCommon = async () => {
    const sequence = ++commonSequence.current;
    clearManualLists({ preserveProcesses: true });
    try {
      const [catalog, overview] = await Promise.all([
        fetchManualList('common', () => listProcedureManualCommon()), fetchManualList('overview', () => getProcedureManualOverview())
      ]);
      if (!mounted.current || sequence !== commonSequence.current) return;
      setCommonCatalog(catalog); setItems(overview.processes.flatMap(row => row.items));
      setProcesses(current => [...current.filter(row => row.subjectKind !== 'COMMON'), ...catalog.categories]);
    } finally {
      if (mounted.current && sequence === commonSequence.current) setOverviewLoading(false);
    }
  };
  useEffect(() => {
    if (!isCommon) return;
    let cancelled = false;
    const sequence = commonSequence.current;
    void fetchManualList('common', () => listProcedureManualCommon()).then(catalog => {
      if (!cancelled && sequence === commonSequence.current) { setCommonCatalog(catalog); setProcesses(current => [...current.filter(row => row.subjectKind !== 'COMMON'), ...catalog.categories]); }
    }).catch(e => { if (!cancelled && sequence === commonSequence.current) setError(readAssemblyApiErrorMessage(e, '分類を取得できません')); });
    return () => { cancelled = true; };
  }, [isCommon, version]);
  useEffect(() => {
    let cancelled = false;
    void fetchManualList('materialCount', () => countProcedureMaterials({ state: 'unplaced' })).then(count => { if (!cancelled) setMaterialCount(count); })
      .catch(() => { if (!cancelled) setMaterialCount(null); });
    return () => { cancelled = true; };
  }, [materialOpen]);
  useEffect(() => {
    let cancelled = false;
    void fetchManualList('videoCount', () => countProcedureVideos({ state: 'active' })).then(count => { if (!cancelled) setVideoCount(count); })
      .catch(() => { if (!cancelled) setVideoCount(null); });
    return () => { cancelled = true; };
  }, [videoOpen]);
  const select = (model: string, process = '', selectedKind?: 'MODEL' | 'PART' | 'COMMON') => {
    const next = new URLSearchParams();
    const kind = selectedKind ?? processes.find(row => row.id === process)?.subjectKind ?? subjectKind;
    setAllKind(kind);
    if (kind === 'COMMON') next.set('common', '1');
    if (model && kind !== 'COMMON') next.set(kind === 'PART' ? 'part' : 'model', model);
    if (process) next.set('process', process);
    setParams(next, { replace: true });
  };
  const selectProcess = (id: string) => {
    if (!id && !processId) return;
    const kind = processes.find(row => row.id === id)?.subjectKind ?? (isCommon ? 'COMMON' : 'MODEL');
    if (kind !== subjectKind) { setSearch(''); setDigitQuery(''); }
    select(kind === subjectKind ? modelCodeKey : '', id, kind);
  };
  const process = processes.find(row => row.id === processId && row.parentId);
  const modelCode = items.find(row => row.modelCodeKey === modelCodeKey)?.modelCode ?? candidates.find(row => row.modelCodeKey === modelCodeKey)?.modelCode ?? modelCodeKey;
  const parsedNames = useMemo(() => new Map(items.map(item => { const name = item.label || item.title; return [name, splitProcedureManualName(name)] as const; })), [items]);
  const normalizedNameFilter = nameFilter.normalize('NFKC').trim().toLocaleLowerCase();
  const filteredItems = isCommon ? filterProcedureManualCommonItems(items, processes, processId, kanaRow, search) : items.filter(item => {
    if (item.subjectKind === 'COMMON' || processes.find(row => row.id === item.processId)?.subjectKind === 'COMMON') return false;
    const matchesStatus = statusFilter === '全て'
      || (statusFilter === '公開' && item.status === 'published')
      || (statusFilter === '下書き' && item.status === 'draft' && !item.draftRevision)
      || (statusFilter === '改版中' && Boolean(item.draftRevision));
    return (!modelCodeKey || item.modelCodeKey === modelCodeKey) && (!processId || item.processId === processId) && (!modelCodeKey || (processes.find(row => row.id === item.processId)?.subjectKind ?? 'MODEL') === subjectKind) && matchesStatus && (item.label || item.title).normalize('NFKC').toLocaleLowerCase().includes(normalizedNameFilter);
  });
  const rowProcessName = (item: ProcedureManualAssignmentOverviewItemDto) => {
    const child = processes.find(row => row.id === item.processId);
    if (item.subjectKind === 'COMMON' || child?.subjectKind === 'COMMON') return `共通 › ${child?.name ?? item.category ?? ''}`;
    return `${shortName(processes.find(row => row.id === child?.parentId))} › ${shortName(child)}`;
  };
  const openEditor = (item: ProcedureManualAssignmentOverviewItemDto) => {
    clearManualLists();
    navigate(kioskAssemblyProcedureDocumentEditPath(item.draftRevision?.documentId ?? item.documentId), {
      state: { returnTo: isCommon ? commonReturnTo : kioskAssemblyManualsWorkshopPath({ [subjectKind === 'PART' ? 'part' : 'model']: modelCodeKey, process: processId }),
        context: { modelCode: item.modelCode, modelCodeKey: item.modelCodeKey, processId: item.processId, processName: rowProcessName(item), mode: 'fix' } }
    });
  };
  const fix = (item: ProcedureManualAssignmentOverviewItemDto) => openEditor(item);
  const view = async (item: ProcedureManualAssignmentOverviewItemDto) => {
    setPreviewLoading(true); setError(null);
    try {
      setPreviewTitle(item.label || item.title);
      if (item.kind === 'assembly_procedure_document') {
        setPreviewSequence(procedureDocumentToSequence(await getAssemblyProcedureDocument(item.documentId)));
      } else {
        const detail = await getProcedureManualAssignments(item.modelCodeKey, item.processId);
        const documents = detail.sequence.documents.filter(row => row.kioskDocumentId === item.documentId);
        if (!documents.length) throw new Error('文書を表示できません');
        setPreviewSequence({ ...detail.sequence, documents, steps: detail.sequence.steps?.filter(row => row.kioskDocumentId === item.documentId) });
      }
    } catch (cause) { setError(readAssemblyApiErrorMessage(cause, '文書を表示できません')); }
    finally { setPreviewLoading(false); }
  };
  const remove = async (item: ProcedureManualAssignmentOverviewItemDto, deleteDocument = false) => {
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
      if (deleteDocument) await deleteAssemblyProcedureDocument(item.documentId, '');
      setVersion(value => value + 1);
    } catch (e) {
      if (unassigned && deleteDocument) {
        setVersion(value => value + 1);
        setOperationMessage(`${readAssemblyApiErrorMessage(e, '削除できません')}。文書は未割り当てのまま残っています。`);
      } else setError(readAssemblyApiErrorMessage(e, '割り当てを外せません'));
    }
    finally { setBusy(false); }
  };
  const discardRevision = async (item: ProcedureManualAssignmentOverviewItemDto) => {
    if (busy || !item.draftRevision || item.draftRevision.editLease) return;
    setBusy(true); setOperationMessage(null);
    try {
      await discardAssemblyProcedureDocumentRevision({
        id: item.draftRevision.documentId,
        accessPassword: '',
        expectedEditVersion: item.draftRevision.editVersion
      });
    } catch (cause) { setOperationMessage(readAssemblyApiErrorMessage(cause, '改版を破棄できません')); }
    finally { setBusy(false); setVersion(value => value + 1); }
  };
  const confirmDiscard = (item: ProcedureManualAssignmentOverviewItemDto) => {
    if (!busy && item.draftRevision && !item.draftRevision.editLease) setDiscarding(item);
  };
  const splitRowName = (item: ProcedureManualAssignmentOverviewItemDto) => {
    const fullName = item.label || item.title;
    const child = processes.find(process => process.id === item.processId);
    return parsedNames.get(fullName) ?? {
      partName: fullName, subjectKey: item.modelCode,
      process: shortName(processes.find(process => process.id === child?.parentId)), work: shortName(child), supplement: ''
    };
  };
  // Columns nobody in the list fills are collapsed so the name gets their width.
  // Which optional action buttons a row shows; 削除/外す is always shown in addition.
  const rowActions = (item: ProcedureManualAssignmentOverviewItemDto) => ({
    view: item.status !== 'unavailable',
    fix: item.kind === 'assembly_procedure_document' && item.status !== 'unavailable',
    rename: !isCommon && item.kind === 'assembly_procedure_document' && item.status !== 'unavailable' && !item.label,
    reattach: processes.find(row => row.id === item.processId)?.subjectKind === 'PART' && item.kind === 'assembly_procedure_document' && item.status === 'draft' && !item.draftRevision,
    use: item.kind === 'assembly_procedure_document' && item.status === 'published',
    discard: Boolean(item.draftRevision)
  });
  // Each action button is 44px wide with a 4px gap; size the column to the row that shows the most buttons.
  const maxActionButtons = Math.max(1, ...filteredItems.map(item => Object.values(rowActions(item)).filter(Boolean).length + 1));
  const actionColumn = `${maxActionButtons * 44 + (maxActionButtons - 1) * 4}px`;
  const usageColumn = filteredItems.some(item => item.otherAssignments.length > 0) ? '180px' : '0px';
  const approvalColumn = filteredItems.some(item => item.draftRevision || item.approval) ? '150px' : '0px';
  return <div className="grid min-h-0 flex-1 grid-rows-[64px_minmax(0,1fr)] bg-[#0f1317] text-[#eef3f6]" data-testid="procedure-manuals-workshop">
    <header className="flex items-center gap-4 border-b border-[#27313b] bg-[#161c22] px-5">
      <h1 className="text-[26px] font-black tracking-widest">要領書</h1>
      <span className="inline-flex h-10 items-center gap-2 rounded-full bg-[#f6b93b29] px-3.5 text-[19px] font-bold text-[#f6b93b]"><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>作る・直す</span>
      <div className="ml-auto flex gap-4">
        <button className={`${action} gap-2 text-[19px]`} onClick={() => { clearManualLists(); setMaterialOpen(true); }}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>素材 {materialCount ?? '—'}</button>
        <button className={`${action} gap-2 text-[19px]`} onClick={() => { clearManualLists(); setVideoOpen(true); }}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>動画 {videoCount ?? '—'}</button>
        <Link to="/kiosk/assembly" className={`${action} gap-2 text-[19px]`}>組立へ戻る</Link>
      </div>
    </header>
    <div className="grid min-h-0 grid-cols-[460px_minmax(0,1fr)]">
      <ProcedureManualFilterPane topActions={(isCommon ? process?.subjectKind === 'COMMON' : modelCodeKey && process) ? <>
        <button className={`${primaryAction} h-14 shrink-0`} disabled={busy || (isCommon && (previewLoading || categoryBusy))} onClick={() => { clearManualLists(); setBlankOpen(true); }}><svg aria-hidden="true" className="mr-2 h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>作る</button>
        {!isCommon ? <button aria-label="既存の要領書を割り当てる" className={`${action} h-14 shrink-0`} disabled={busy || overviewLoading} onClick={() => setAssignmentOpen(true)}>＋ 既存を割り当てる</button> : null}
      </> : null} allowKindChangeWithProcess subjectKind={subjectKind} onKindChange={kind => { if (kind !== subjectKind) { setSearch(''); setDigitQuery(''); setKanaRow(''); select('', '', kind); } }} processes={processes} items={items} models={candidates} partSearchCandidates={partCandidates} modelCodeKey={modelCodeKey} processId={processId}
        search={search} digitQuery={digitQuery} onSearchChange={setSearch} onDigitQueryChange={setDigitQuery}
        onModelSelect={key => select(key === modelCodeKey ? '' : key, processId)} onProcessSelect={selectProcess}
        categoryEditor={{ choices: commonCatalog.categories, onChanged: refreshCommon, beforeMutation, onDeleted: clearDeletedCategory, onBusyChange: setCategoryBusy, disabled: categoryBusy }}
        kanaRow={kanaRow} onKanaRowChange={setKanaRow} loading={isCommon ? overviewLoading : searchLoading} error={searchError} hasMore={hasMore} />
      <section aria-label="要領書一覧" className={isCommon ? 'flex min-h-0 min-w-0 flex-col' : 'grid min-h-0 min-w-0 content-start overflow-auto px-4 py-3'}>
        {isCommon ? <ProcedureManualCommonList items={filteredItems} processes={processes} categoryId={processId} kanaRow={kanaRow} busy={busy || previewLoading}
          onView={item => void view(item)} onFix={fix} onDiscard={confirmDiscard}
          onRename={item => { setOperationMessage(null); setCommonRenaming(item); }}
          onRemove={(item, deleteDocument) => { if (deleteDocument) setDeleting(item); else setRemoving(item); }} /> : <>
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
          </div>
          <div role="table" aria-label={process ? shortName(process) : '全工程'} className="min-w-[1100px]">
          <div role="row" className="sr-only">
            {['品名', '品番', '工程', '作業', '補足', '状態', '他の使用先', '担当・承認', 'ページ', '操作'].map(label => <div role="columnheader" key={label}>{label}</div>)}
          </div>
          {filteredItems.map(item => {
            const fullName = item.label || item.title;
            const actions = rowActions(item);
            const name = splitRowName(item);
            return <div role="row" key={item.assignmentId} aria-label={item.label || item.title} title={fullName} style={{ gridTemplateColumns: `minmax(0,1.5fr) minmax(0,1.5fr) 96px 128px minmax(0,0.6fr) 120px ${usageColumn} ${approvalColumn} 40px ${actionColumn}` }} className="grid h-14 items-center gap-3 border-b border-[#27313b] px-2.5 hover:bg-[#1b222a]">
            <div role="cell" className="min-w-0 truncate text-xl font-bold" title={fullName}>{name.partName}</div>
            <div role="cell" className="min-w-0 truncate font-mono text-[17px] font-bold">{name.subjectKey}</div>
            <div role="cell" className="min-w-0 truncate text-[17px]">{name.process}</div>
            <div role="cell" className="min-w-0 truncate text-[17px]">{name.work}</div>
            <div role="cell" className="min-w-0 truncate text-[17px] text-[#9fadb9]">{name.supplement || '—'}</div>
            <div role="cell">
                <span className={`${badge} ${item.status === 'published' ? 'border-[#3ba776] text-[#3ba776]' : item.status === 'draft' ? 'border-[#f6b93b] text-[#f6b93b]' : 'border-[#e5484d] text-[#e5484d]'}`}>
                  {item.status === 'published' ? item.publishedRevisionNumber == null ? '公開' : `公開 第${item.publishedRevisionNumber}版` : item.status === 'draft' ? '下書き' : '無効'}
                </span>
            </div>
            <div role="cell" className="min-w-0 truncate text-[15px] text-[#9fadb9]">{usageLabel(item.otherAssignments) || '—'}</div>
            <div role="cell" className="min-w-0 truncate text-base text-[#9fadb9]">
              {item.draftRevision ? <span className="rounded-full bg-[#f6b93b1f] px-2.5 py-1 text-[#f6b93b]">改版中{item.draftRevision.editLease ? ` · ${item.draftRevision.editLease.holderLabel} ${new Date(item.draftRevision.editLease.acquiredAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}〜` : ''}</span> : item.approval ? `承認 ${item.approval.employeeName} ${new Date(item.approval.approvedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}` : null}
            </div>
            <div role="cell" className="text-right font-mono text-base text-[#9fadb9]">{item.pageCount ?? '—'}{item.pageCount != null ? <span className="sr-only"> ページ</span> : null}</div>
            <div role="cell" className="flex gap-1">
              {actions.view ? <IconActionTooltip label="見る" disabled={previewLoading}><button aria-label="見る" className={`${symbolAction} !border-[#344252] !text-[#eef3f6]`} disabled={previewLoading} onClick={() => void view(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg></button></IconActionTooltip> : null}
              {actions.fix ? <IconActionTooltip label="直す" disabled={busy}><button aria-label="直す" className={`${symbolAction} !border-[#3ba776] !text-[#3ba776]`} disabled={busy} onClick={() => fix(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg></button></IconActionTooltip> : null}
              {actions.rename ? <IconActionTooltip label="名前を変える" disabled={busy || Boolean(item.draftRevision?.editLease)}><button aria-label="名前を変える" className={symbolAction} disabled={busy || Boolean(item.draftRevision?.editLease)} onClick={() => { setOperationMessage(null); setRenaming(item); }}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 7V5h12v2M10 5v14M7 19h6M16 13h5M18.5 13v6M17 19h3" /></svg></button></IconActionTooltip> : null}
              {actions.reattach ? <IconActionTooltip label="部品を付け直す" disabled={busy}><button aria-label="部品を付け直す" className={`${symbolAction} !border-[#f6b93b] !text-[#f6b93b]`} disabled={busy} onClick={() => { setOperationMessage(null); setReattaching(item); }}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.4" /></svg></button></IconActionTooltip> : null}
              {actions.use ? <IconActionTooltip label="使う"><Link aria-label="使う" className={symbolAction} to={kioskAssemblyTemplateNewPath({ procedureDocumentId: item.documentId })}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg></Link></IconActionTooltip> : null}
              {actions.discard && item.draftRevision ? <IconActionTooltip label="改版を破棄" disabled={busy || Boolean(item.draftRevision.editLease)}><button aria-label="改版を破棄" className={symbolAction} disabled={busy || Boolean(item.draftRevision.editLease)} onClick={() => confirmDiscard(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg></button></IconActionTooltip> : null}
              {canDelete(item) ? <IconActionTooltip label="削除" disabled={busy}><button aria-label="削除" className={symbolAction} disabled={busy} onClick={() => setDeleting(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg></button></IconActionTooltip> : <IconActionTooltip label="外す" disabled={busy}><button aria-label="外す" className={symbolAction} disabled={busy} onClick={() => setRemoving(item)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg></button></IconActionTooltip>}
            </div>
          </div>; })}
          </div>
          {!overviewLoading && filteredItems.length === 0 ? <p className="p-4 text-lg text-[#9fadb9]">該当する要領書がありません</p> : null}
        </>}
        {overviewLoading ? <p role="status" className="text-[#9fadb9]">読込中…</p> : null}
        {error ? <p role="alert" className="text-red-400">{error}</p> : null}
        {operationMessage ? <p role="alert" className="text-amber-300">{operationMessage}</p> : null}
      </section>
    </div>
    {blankOpen && isCommon ? <ProcedureManualCommonDialog catalog={commonCatalog} items={items.filter(item => item.subjectKind === 'COMMON' || processes.find(row => row.id === item.processId)?.subjectKind === 'COMMON')} categoryId={processId} beforeMutation={beforeMutation} onClose={() => setBlankOpen(false)} onChanged={refreshCommon} onFix={fix} /> : null}
    {blankOpen && !isCommon ? <ProcedureManualBlankDialog subjectKind={subjectKind === 'PART' ? 'PART' : 'MODEL'} beforeMutation={() => { clearManualLists(); return true; }} processes={processes} modelCode={modelCode} processId={processId} onClose={() => setBlankOpen(false)} /> : null}
    {assignmentOpen ? <ProcedureManualAssignmentDialog beforeMutation={() => true} modelCode={modelCode} processId={processId} processes={processes} onClose={() => setAssignmentOpen(false)} onSaved={(key, id) => { setAssignmentOpen(false); select(key, id); setVersion(value => value + 1); }} /> : null}
    {reattaching ? <ProcedureManualReattachPartDialog item={reattaching} processes={processes} currentPartName={partCandidates.find(row => row.partNumberKey === reattaching.modelCodeKey)?.partName}
      beforeMutation={() => true} onClose={() => setReattaching(null)} onChanged={() => setVersion(value => value + 1)}
      onSaved={(key, id, message) => { setReattaching(null); select(key, id); setVersion(value => value + 1); setOperationMessage(message); }} /> : null}
    {isCommon && commonRenaming ? <ProcedureManualCommonRenameDialog item={commonRenaming} catalog={commonCatalog} onClose={() => setCommonRenaming(null)}
      onSaved={() => { setCommonRenaming(null); void refreshCommon(); }} /> : null}
    {renaming ? <ProcedureManualRenameDialog item={renaming} name={splitRowName(renaming)} onClose={() => setRenaming(null)}
      onSaved={() => { setRenaming(null); setVersion(value => value + 1); }} /> : null}
    {materialOpen ? <ProcedureMaterialShelfDialog resources={shelfResources} onClose={() => { clearManualLists(); setMaterialOpen(false); }} onCreatedDocument={(documentId) => {
      clearManualLists();
      setMaterialOpen(false);
      navigate(kioskAssemblyProcedureDocumentEditPath(documentId), { state: { returnTo: isCommon ? commonReturnTo : kioskAssemblyManualsWorkshopPath({ [subjectKind === 'PART' ? 'part' : 'model']: modelCodeKey, process: processId }) } });
    }} /> : null}
    {videoOpen ? <ProcedureVideoShelfDialog onClose={() => { clearManualLists(); setVideoOpen(false); }} /> : null}
    {previewSequence ? <ProcedureManualFullscreenPreview sequence={previewSequence} title={previewTitle} onClose={() => setPreviewSequence(null)} /> : null}
    <ConfirmDialog isOpen={Boolean(removing)} title="この工程から外す" description={removing ? `${removing.label || removing.title}。${removing.otherAssignments.length ? `他の使用先に残ります：${usageLabel(removing.otherAssignments)}` : '手順書一覧に「未使用」で残ります'}` : undefined} confirmLabel="外す" buttonClassName="min-h-12" onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) void remove(removing); setRemoving(null); }} />
    <ConfirmDialog isOpen={Boolean(discarding)} title="改版を破棄" description={discarding ? `${discarding.label || discarding.title}。元に戻せません` : undefined} confirmLabel="破棄" tone="danger" buttonClassName="min-h-12" onCancel={() => setDiscarding(null)} onConfirm={() => { if (discarding) void discardRevision(discarding); setDiscarding(null); }} />
    <ConfirmDialog isOpen={Boolean(deleting)} title="下書きを削除" description={deleting ? `${deleting.label || deleting.title}。元に戻せません` : undefined} confirmLabel="削除" tone="danger" buttonClassName="min-h-12" onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting, true); setDeleting(null); }} />
  </div>;
}
