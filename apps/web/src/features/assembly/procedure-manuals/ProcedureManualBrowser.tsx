import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { getProcedureManualAssignments, getProcedureManualOverview, listProcedureManualModels, listProcedureManualProcesses } from '../../../api/client';
import { AssemblyProcedureSequenceViewer } from '../AssemblyProcedureSequenceViewer';
import { kioskAssemblyManualsWorkshopPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ManualThumbnail } from './ManualThumbnail';
import { procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualFilterPane } from './ProcedureManualFilterPane';
import { ProcedureManualPageRail } from './ProcedureManualPageRail';
import { ProcedurePageVideoStrip } from './ProcedurePageVideoStrip';

import type { AssemblyProcedureSequencePageDto, ProcedureManualDetailDto, ProcedureManualAssignmentOverviewItemDto, ProcedureManualModelDto, ProcedureManualProcessDto } from '../types';

const shortName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';

export function ProcedureManualBrowser() {
  const [params] = useSearchParams();
  const [listOpen, setListOpen] = useState(() => {
    try { return localStorage.getItem('procedure-manuals-list-open') === 'true'; } catch { return false; }
  });
  const [twoPages, setTwoPages] = useState(false);
  const toggleList = () => {
    const next = !listOpen;
    setListOpen(next);
    if (next) setTwoPages(false);
    try { localStorage.setItem('procedure-manuals-list-open', String(next)); } catch { /* Storage is optional on kiosk devices. */ }
  };
  const [models, setModels] = useState<ProcedureManualModelDto[]>([]);
  const [processes, setProcesses] = useState<ProcedureManualProcessDto[]>([]);
  const [modelCodeKey, setModelCodeKey] = useState(() => procedureManualModelKey(params.get('model') ?? ''));
  const [processId, setProcessId] = useState(() => params.get('process') ?? '');
  const [userSelectedModel, setUserSelectedModel] = useState(false);
  const [initialDocumentId, setInitialDocumentId] = useState<string>();
  const [items, setItems] = useState<ProcedureManualAssignmentOverviewItemDto[]>([]);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ProcedureManualDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<AssemblyProcedureSequencePageDto | null>(null);
  const onPageChange = useCallback((page: AssemblyProcedureSequencePageDto | null) => setCurrentPage(page), []);
  const approval = detail?.sequence.documents.find(document => (document.assemblyProcedureDocumentId ?? document.kioskDocumentId) === currentPage?.documentId)?.lastApproval;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listProcedureManualModels(), listProcedureManualProcesses(), getProcedureManualOverview(undefined, true)]).then(([nextModels, nextProcesses, nextOverview]) => {
      if (!cancelled) { setModels(nextModels); setProcesses(nextProcesses); setItems(nextOverview.processes.flatMap(process => process.items)); }
    }).catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '一覧を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!modelCodeKey || !userSelectedModel) return;
    const available = [...new Set(items.filter(item => item.modelCodeKey === modelCodeKey).map(item => item.processId))];
    if (available.length === 1) setProcessId(current => current || available[0]);
  }, [items, modelCodeKey, userSelectedModel]);

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
  const visibleItems = items.filter(item => (!modelCodeKey || item.modelCodeKey === modelCodeKey)
    && (!processId || item.processId === processId));
  const showOverview = listOpen && (!modelCodeKey || !processId);
  const toolClass = 'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[#344252] px-3.5 text-[19px] font-bold disabled:opacity-40';
  return (
    <div className={`grid min-h-0 flex-1 ${listOpen ? 'grid-cols-[460px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'} bg-[#0f1317] text-[#eef3f6]`} data-open={listOpen} data-pages={twoPages ? 2 : 1} data-testid="procedure-manuals-split">
      <div hidden={!listOpen} className={`${listOpen ? 'flex' : 'hidden'} min-h-0 flex-col border-r border-[#27313b] bg-[#161c22]`} data-testid="procedure-manuals-left">
        <header className="grid shrink-0 gap-2 border-b border-[#27313b] px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-2.5 text-2xl font-black tracking-widest">要領書</h1>
            <Link to={kioskAssemblyManualsWorkshopPath({ model: modelCodeKey, process: processId })} className={toolClass}>作る・直す</Link>
            <Link to="/kiosk/assembly" className={`${toolClass} border-transparent text-[#9fadb9]`}>組立へ戻る</Link>
          </div>
        </header>
        <ProcedureManualFilterPane processes={processes} items={items} models={visibleModels}
          modelCodeKey={modelCodeKey} processId={processId} search={search} digitQuery={search}
          onSearchChange={setSearch} onDigitQueryChange={setSearch}
          onModelSelect={(key) => {
            setInitialDocumentId(undefined);
            const next = key === modelCodeKey ? '' : key;
            setUserSelectedModel(Boolean(next)); setModelCodeKey(next);
            if (modelCodeKey && next) setProcessId('');
          }}
          onProcessSelect={(id) => { setInitialDocumentId(undefined); setProcessId(id); }} loading={loading} error={error} />
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
        {showOverview ? <section aria-label="要領書一覧" className="min-h-0 flex-1 overflow-auto pr-16">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_180px_130px_70px] items-center gap-3 border-b border-[#27313b] px-5 py-3 text-[17px] font-bold text-[#9fadb9]">
            <span aria-hidden="true" /><span>名前</span><span>機種</span><span>工程</span><span>ページ数</span>
          </div>
          {visibleItems.map(item => <button type="button" key={item.assignmentId} aria-label={item.title}
            className="grid min-h-[72px] w-full grid-cols-[64px_minmax(0,1fr)_180px_130px_70px] items-center gap-3 border-b border-[#27313b] px-5 py-3 text-left text-[19px] hover:bg-[#1b222a]"
            onClick={() => { setInitialDocumentId(item.documentId); setUserSelectedModel(true); setModelCodeKey(item.modelCodeKey); setProcessId(item.processId); }}>
            <ManualThumbnail url={item.thumbnailPageUrl} /><span className="min-w-0 truncate font-bold">{item.title}</span>
            <span className="truncate font-mono">{item.modelCode}</span><span>{shortName(processes.find(process => process.id === item.processId))}</span>
            <span className="text-center font-mono">{item.pageCount ?? '—'}</span>
          </button>)}
          {loading ? <p role="status" className="p-5 text-[17px] text-[#9fadb9]">読込中…</p> : visibleItems.length === 0 ? <p className="p-5 text-[17px] text-[#9fadb9]">該当する要領書がありません</p> : null}
        </section> : !processId ? <p className="p-2 text-sm text-[#9fadb9]">工程を選択</p> : !detail && !error ? <p role="status">読込中…</p> : null}

        {!showOverview && detail && detail.sequence.documents.length > 0 ? <AssemblyProcedureSequenceViewer key={`${modelCodeKey}:${processId}`} sequence={detail.sequence} initialDocumentId={initialDocumentId} layout="manuals" showCurrentMarkerButton={false} onCurrentPageChange={onPageChange} listOpen={listOpen} onToggleList={toggleList} twoPages={twoPages} onToggleTwoPages={() => setTwoPages(!twoPages)} className="min-h-0 flex-1" /> : !showOverview && detail ? <p className="p-2 text-sm text-[#9fadb9]">表示できる文書がありません</p> : null}
        {showOverview || !detail || detail.sequence.documents.length === 0 ? <ProcedureManualPageRail listOpen={listOpen} onToggleList={toggleList} /> : null}
      </section>
    </div>
  );
}
