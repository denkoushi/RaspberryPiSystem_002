import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { getProcedureManualAssignments, getProcedureManualModelOverview, listProcedureManualModels, listProcedureManualProcesses } from '../../../api/client';
import { Input } from '../../../components/ui/Input';
import { AssemblyProcedureSequenceViewer } from '../AssemblyProcedureSequenceViewer';
import { kioskAssemblyManualsWorkshopPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualModelMatch, ProcedureManualModelTenkey } from './ProcedureManualModelSearch';
import { ProcedureManualPageRail } from './ProcedureManualPageRail';
import { ProcedurePageVideoStrip } from './ProcedurePageVideoStrip';

import type { AssemblyProcedureSequencePageDto, ProcedureManualDetailDto, ProcedureManualModelDto, ProcedureManualModelOverviewDto, ProcedureManualProcessDto } from '../types';

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
  const [overview, setOverview] = useState<ProcedureManualModelOverviewDto | null>(null);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ProcedureManualDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<AssemblyProcedureSequencePageDto | null>(null);
  const onPageChange = useCallback((page: AssemblyProcedureSequencePageDto | null) => setCurrentPage(page), []);
  const approval = detail?.sequence.documents.find(document => (document.assemblyProcedureDocumentId ?? document.kioskDocumentId) === currentPage?.documentId)?.lastApproval;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listProcedureManualModels(), listProcedureManualProcesses()]).then(([nextModels, nextProcesses]) => {
      if (!cancelled) { setModels(nextModels); setProcesses(nextProcesses); }
    }).catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '一覧を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    if (!modelCodeKey) return;
    void getProcedureManualModelOverview(modelCodeKey).then(next => {
      if (cancelled) return;
      setOverview(next);
      const available = next.processes.filter(process => process.count > 0);
      if (userSelectedModel && available.length === 1) {
        setProcessId(current => current || available[0].processId);
      }
    }).catch(() => { /* Counts are optional; keep browsing available. */ });
    return () => { cancelled = true; };
  }, [modelCodeKey, userSelectedModel]);

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
        {error ? <p role="alert" className="px-3 py-2 text-sm text-red-400">{error}</p> : null}
        <section aria-label="機種一覧" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-4">
            <h2 className="text-base font-bold tracking-widest text-[#9fadb9]">機種</h2>
            <Input type="search" aria-label="機種検索" placeholder="型番で検索" className="h-12 shrink-0 text-[21px]" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="grid shrink-0 grid-cols-[200px_minmax(0,1fr)] items-start gap-3">
              <ProcedureManualModelTenkey value={search} onChange={setSearch} />
              <section aria-label="工程一覧" className="flex min-w-0 flex-col gap-1">
                <h2 className="text-base font-bold tracking-widest text-[#9fadb9]">工程</h2>
                {!modelCodeKey ? <p className="text-sm text-[#9fadb9]">機種を選択</p> : processes.filter((p) => p.parentId).map((process) => {
                  const parent = processes.find((p) => p.id === process.parentId);
                  const count = overview?.processes.find(row => row.processId === process.id)?.count;
                  return <button key={process.id} aria-label={`${parent?.name ?? ''} › ${process.name}`} className={`flex min-h-[46px] shrink-0 items-center rounded-lg px-3 text-left text-[19px] font-bold ${processId === process.id ? 'bg-[#27313b]' : 'hover:bg-[#27313b]'} ${count === 0 ? 'text-[#6b7885]' : ''}`} aria-pressed={processId === process.id} onClick={() => setProcessId(process.id)}>
                    {shortName(parent)} › {shortName(process)}<span aria-hidden="true" className={`ml-auto pl-2 font-mono text-[17px] ${count && count > 0 ? 'font-bold text-[#eef3f6]' : 'font-normal text-[#9fadb9]'}`}>{count && count > 0 ? count : '—'}</span>
                  </button>;
                })}
              </section>
            </div>
            {loading ? <p role="status" className="mt-2 text-sm">読込中…</p> : visibleModels.length === 0 ? <p className="mt-2 text-sm text-[#9fadb9]">機種がありません</p> : null}
            {visibleModels.map((model) => <button key={model.modelCodeKey} className={`min-h-12 shrink-0 rounded-lg px-3 text-left font-mono text-[18px] font-bold break-all ${modelCodeKey === model.modelCodeKey ? 'bg-[#27313b]' : 'hover:bg-[#27313b]'}`} aria-label={model.modelCodeKey} aria-pressed={modelCodeKey === model.modelCodeKey} onClick={() => { setUserSelectedModel(true); setModelCodeKey(model.modelCodeKey); setProcessId(''); }}><ProcedureManualModelMatch code={model.modelCodeKey} search={procedureManualModelKey(search)} /></button>)}
        </section>
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
        {!processId ? <p className="p-2 text-sm text-[#9fadb9]">工程を選択</p> : !detail && !error ? <p role="status">読込中…</p> : null}

        {detail && detail.sequence.documents.length > 0 ? <AssemblyProcedureSequenceViewer key={`${modelCodeKey}:${processId}`} sequence={detail.sequence} layout="manuals" showCurrentMarkerButton={false} onCurrentPageChange={onPageChange} listOpen={listOpen} onToggleList={toggleList} twoPages={twoPages} onToggleTwoPages={() => setTwoPages(!twoPages)} className="min-h-0 flex-1" /> : detail ? <p className="p-2 text-sm text-[#9fadb9]">表示できる文書がありません</p> : null}
        {!detail || detail.sequence.documents.length === 0 ? <ProcedureManualPageRail listOpen={listOpen} onToggleList={toggleList} /> : null}
      </section>
    </div>
  );
}
