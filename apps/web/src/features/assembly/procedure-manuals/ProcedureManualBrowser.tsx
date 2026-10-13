import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { getProcedureManualAssignments, getProcedureManualOverview, listProcedureManualCommon, listProcedureManualModels, listProcedureManualParts, listProcedureManualProcesses } from '../../../api/client';
import { normalizeWorkInstructionPartNumber } from '../../../lib/workInstructionRules';
import { AssemblyProcedureSequenceViewer } from '../AssemblyProcedureSequenceViewer';
import { kioskAssemblyManualsWorkshopPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ManualThumbnail } from './ManualThumbnail';
import { splitProcedureManualName } from './procedure-manual-name';
import { procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualCommonList, filterProcedureManualCommonItems } from './ProcedureManualCommonList';
import { ProcedureManualFilterPane } from './ProcedureManualFilterPane';
import { ProcedureManualPageRail } from './ProcedureManualPageRail';
import { ProcedurePageVideoStrip } from './ProcedurePageVideoStrip';

import type { AssemblyProcedureSequencePageDto, ProcedureManualDetailDto, ProcedureManualAssignmentOverviewItemDto, ProcedureManualModelDto, ProcedureManualProcessDto } from '../types';

const shortName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';

export function ProcedureManualBrowser() {
  const [params, setParams] = useSearchParams();
  const [listOpen, setListOpen] = useState(() => {
    if (params.has('common')) return true;
    try { return localStorage.getItem('procedure-manuals-list-open') === 'true'; } catch { return false; }
  });
  const [twoPages, setTwoPages] = useState(false);
  const toggleList = () => {
    const next = !listOpen;
    setListOpen(next);
    if (next) { setTwoPages(false); if (subjectKind === 'COMMON') setModelCodeKey(''); }
    try { localStorage.setItem('procedure-manuals-list-open', String(next)); } catch { /* Storage is optional on kiosk devices. */ }
  };
  const [models, setModels] = useState<ProcedureManualModelDto[]>([]);
  const [processes, setProcesses] = useState<ProcedureManualProcessDto[]>([]);
  const [allKind, setAllKind] = useState<'MODEL' | 'PART' | 'COMMON'>(() => params.has('common') ? 'COMMON' : params.has('part') ? 'PART' : 'MODEL');
  const [modelCodeKey, setModelCodeKey] = useState(() => params.has('common') ? '' : params.has('part') ? normalizeWorkInstructionPartNumber(params.get('part')) : procedureManualModelKey(params.get('model') ?? ''));
  const [processId, setProcessId] = useState(() => params.get('process') ?? '');
  const subjectKind = processes.find(row => row.id === processId)?.subjectKind ?? allKind;
  const [kanaRow, setKanaRow] = useState('');
  const [partCandidates, setPartCandidates] = useState<ProcedureManualModelDto[]>([]);
  const [userSelectedModel, setUserSelectedModel] = useState(false);
  const [initialDocumentId, setInitialDocumentId] = useState<string>();
  const [items, setItems] = useState<ProcedureManualAssignmentOverviewItemDto[]>([]);
  const [search, setSearch] = useState('');
  const [partDigits, setPartDigits] = useState('');
  const [detail, setDetail] = useState<ProcedureManualDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<AssemblyProcedureSequencePageDto | null>(null);
  const onPageChange = useCallback((page: AssemblyProcedureSequencePageDto | null) => setCurrentPage(page), []);
  const approval = detail?.sequence.documents.find(document => (document.assemblyProcedureDocumentId ?? document.kioskDocumentId) === currentPage?.documentId)?.lastApproval;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listProcedureManualModels(), allKind === 'COMMON' ? listProcedureManualCommon(true).then(() => listProcedureManualProcesses()) : listProcedureManualProcesses(), getProcedureManualOverview(undefined, true), listProcedureManualParts()]).then(([nextModels, nextProcesses, nextOverview, nextParts]) => {
      if (!cancelled) { setModels(nextModels); setProcesses(nextProcesses); setItems(nextOverview.processes.flatMap(process => process.items)); setPartCandidates(nextParts.map(part => ({ modelCode: part.partNumber, modelCodeKey: part.partNumberKey }))); }
    }).catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '一覧を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allKind]);

  useEffect(() => {
    if (!modelCodeKey || !userSelectedModel) return;
    const available = [...new Set(items.filter(item => item.modelCodeKey === modelCodeKey && (processes.find(process => process.id === item.processId)?.subjectKind ?? 'MODEL') === subjectKind).map(item => item.processId))];
    if (available.length === 1) setProcessId(current => current || available[0]);
  }, [items, modelCodeKey, userSelectedModel, processes, subjectKind]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setCurrentPage(null);
    setError(null);
    if (!modelCodeKey || !processId) return;
    void getProcedureManualAssignments(modelCodeKey, processId).then((next) => { if (!cancelled) setDetail(next); })
      .catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '要領書を取得できません')); });
    return () => { cancelled = true; };
  }, [modelCodeKey, processId]);

  const visibleModels = models.filter((m) => m.modelCodeKey.includes(procedureManualModelKey(search)));
  const visibleItems = subjectKind === 'COMMON' ? filterProcedureManualCommonItems(items, processes, processId, kanaRow, search) : items.filter(item => item.subjectKind !== 'COMMON' && processes.find(row => row.id === item.processId)?.subjectKind !== 'COMMON' && (!modelCodeKey || item.modelCodeKey === modelCodeKey)
    && (!processId || item.processId === processId) && (!modelCodeKey || (processes.find(process => process.id === item.processId)?.subjectKind ?? 'MODEL') === subjectKind));
  const showOverview = listOpen && (subjectKind === 'COMMON' ? !modelCodeKey : !modelCodeKey || !processId);
  const commonReturnTo = kioskAssemblyManualsWorkshopPath({ common: '1', process: processId });
  useEffect(() => {
    const next = new URLSearchParams();
    if (subjectKind === 'COMMON') next.set('common', '1');
    else if (modelCodeKey) next.set(subjectKind === 'PART' ? 'part' : 'model', modelCodeKey);
    if (processId) next.set('process', processId);
    setParams(next, { replace: true });
  }, [subjectKind, modelCodeKey, processId, setParams]);
  const toolClass = 'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[#344252] px-3.5 text-[19px] font-bold disabled:opacity-40';
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0b0f13] text-[#eef3f6]">
      {subjectKind === 'COMMON' && listOpen ? <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[#27313b] px-6">
        <h1 className="text-[26px] font-bold">要領書</h1><span className="rounded-full border border-[#f6b93b] px-3.5 py-0.5 text-[17px] text-[#f6b93b]">見る</span>
        <Link to={commonReturnTo} className={`${toolClass} ml-auto`}>作る・直す</Link><Link to="/kiosk/assembly" className={toolClass}>組立へ戻る</Link>
      </header> : null}
    <div className={`grid min-h-0 flex-1 ${listOpen ? 'grid-cols-[460px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'} bg-[#0f1317] text-[#eef3f6]`} data-open={listOpen} data-pages={twoPages ? 2 : 1} data-testid="procedure-manuals-split">
      <div hidden={!listOpen} className={`${listOpen ? 'flex' : 'hidden'} min-h-0 flex-col border-r border-[#27313b] bg-[#161c22]`} data-testid="procedure-manuals-left">
        <header hidden={subjectKind === 'COMMON'} className={`${subjectKind === 'COMMON' ? 'hidden' : 'grid'} shrink-0 gap-2 border-b border-[#27313b] px-3.5 py-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-2.5 text-2xl font-black tracking-widest">要領書</h1>
            <Link to={subjectKind === 'COMMON' ? commonReturnTo : kioskAssemblyManualsWorkshopPath({ [subjectKind === 'PART' ? 'part' : 'model']: modelCodeKey, process: processId })} className={toolClass}>作る・直す</Link>
            <Link to="/kiosk/assembly" className={`${toolClass} border-transparent text-[#9fadb9]`}>組立へ戻る</Link>
          </div>
        </header>
        <ProcedureManualFilterPane subjectKind={subjectKind} partCandidates={partCandidates} onKindChange={kind => { setAllKind(kind); setModelCodeKey(''); setSearch(''); setPartDigits(''); setUserSelectedModel(false); setKanaRow(''); if (kind === 'COMMON' || subjectKind === 'COMMON') setProcessId(''); }} processes={processes} items={items} models={visibleModels}
          modelCodeKey={modelCodeKey} processId={processId} search={search} digitQuery={subjectKind === 'PART' ? partDigits : search}
          onSearchChange={setSearch} onDigitQueryChange={subjectKind === 'PART' ? setPartDigits : setSearch}
          onModelSelect={(key) => {
            setInitialDocumentId(undefined);
            const next = key === modelCodeKey ? '' : key;
            setUserSelectedModel(Boolean(next)); setModelCodeKey(next);
            if (modelCodeKey && next && subjectKind === 'MODEL') { setAllKind(subjectKind); setProcessId(''); }
          }}
          onProcessSelect={(id) => { if (subjectKind === 'COMMON') setModelCodeKey(''); setInitialDocumentId(undefined); const kind = processes.find(row => row.id === id)?.subjectKind ?? subjectKind; if (kind !== subjectKind) { setModelCodeKey(''); setSearch(''); setPartDigits(''); setUserSelectedModel(false); } setAllKind(kind); setProcessId(id); }} kanaRow={kanaRow} onKanaRowChange={setKanaRow} loading={loading} error={error} />
        <div className="max-h-[40%] shrink-0 overflow-auto px-4">
          {detail?.assignments.filter((a) => a.unavailableReason).map((item) => <p key={item.id} role="status" className="shrink-0 border-t border-[#27313b] p-2 text-sm text-[#f6b93b]">{item.label || `${item.sortOrder + 1}番目の文書`}: {item.unavailableReason === 'no_published_revision' ? '公開版なし' : '文書は無効です'}</p>)}
          {currentPage ? <section aria-label="承認・動画" className="shrink-0 space-y-2 border-t border-[#27313b] py-2.5 text-[17px] text-[#9fadb9]">
            <h2 className="text-base font-bold tracking-widest">承認・動画</h2>
            {approval ? <p className="truncate">承認: {approval.employeeName}{approval.positionName ? `(${approval.positionName})` : ''} {new Date(approval.approvedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p> : null}
            <ProcedurePageVideoStrip key={`${currentPage.documentId}:${currentPage.pageIndex}`} videos={currentPage.videos ?? []} layout="manuals" />
          </section> : null}
        </div>
      </div>
      <section aria-label="要領書" className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#0a0d10]">
        {error && !listOpen ? <p role="alert" className="p-2 text-red-400">{error}</p> : null}
        {showOverview && subjectKind === 'COMMON' ? <ProcedureManualCommonList items={visibleItems} processes={processes} categoryId={processId} kanaRow={kanaRow} onView={item => {
          setInitialDocumentId(item.documentId); setModelCodeKey(item.modelCodeKey); setProcessId(item.processId); setListOpen(false);
        }} /> : showOverview ? <section aria-label="要領書一覧" className="min-h-0 flex-1 overflow-auto pr-16">
          <div className="grid grid-cols-[64px_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_70px] items-center gap-3 border-b border-[#27313b] px-5 py-3 text-[17px] font-bold text-[#9fadb9]">
            <span aria-hidden="true" /><span>品名</span><span>品番</span><span>工程</span><span>作業</span><span>補足</span><span>ページ数</span>
          </div>
          {visibleItems.map(item => {
            const child = processes.find(process => process.id === item.processId);
            const name = splitProcedureManualName(item.title) ?? {
              partName: item.title, subjectKey: item.modelCode,
              process: shortName(processes.find(process => process.id === child?.parentId)), work: shortName(child), supplement: ''
            };
            return <button type="button" key={item.assignmentId} aria-label={item.title} title={item.title}
            className="grid min-h-[72px] w-full grid-cols-[64px_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_70px] items-center gap-3 border-b border-[#27313b] px-5 py-3 text-left text-[19px] hover:bg-[#1b222a]"
            onClick={() => { setAllKind(processes.find(row => row.id === item.processId)?.subjectKind ?? 'MODEL'); setInitialDocumentId(item.documentId); setUserSelectedModel(true); setModelCodeKey(item.modelCodeKey); setProcessId(item.processId); }}>
            <ManualThumbnail url={item.thumbnailPageUrl} />
            <span className="min-w-0 truncate font-bold">{name.partName}</span>
            <span className="min-w-0 truncate font-mono font-bold">{name.subjectKey}</span>
            <span className="min-w-0 truncate">{name.process}</span>
            <span className="min-w-0 truncate">{name.work}</span>
            <span className="min-w-0 truncate text-[#9fadb9]">{name.supplement || '—'}</span>
            <span className="text-center font-mono">{item.pageCount ?? '—'}</span>
          </button>; })}
          {loading ? <p role="status" className="p-5 text-[17px] text-[#9fadb9]">読込中…</p> : visibleItems.length === 0 ? <p className="p-5 text-[17px] text-[#9fadb9]">該当する要領書がありません</p> : null}
        </section> : !processId ? <p className="p-2 text-sm text-[#9fadb9]">工程を選択</p> : !detail && !error ? <p role="status">読込中…</p> : null}

        {!showOverview && detail && detail.sequence.documents.length > 0 ? <AssemblyProcedureSequenceViewer key={`${modelCodeKey}:${processId}`} sequence={detail.sequence} initialDocumentId={initialDocumentId} layout="manuals" showCurrentMarkerButton={false} onCurrentPageChange={onPageChange} listOpen={listOpen} onToggleList={toggleList} twoPages={twoPages} onToggleTwoPages={() => setTwoPages(!twoPages)} className="min-h-0 flex-1" /> : !showOverview && detail ? <p className="p-2 text-sm text-[#9fadb9]">表示できる文書がありません</p> : null}
        {!(subjectKind === 'COMMON' && showOverview) && (showOverview || !detail || detail.sequence.documents.length === 0) ? <ProcedureManualPageRail listOpen={listOpen} onToggleList={toggleList} /> : null}
      </section>
    </div>
    </div>
  );
}
