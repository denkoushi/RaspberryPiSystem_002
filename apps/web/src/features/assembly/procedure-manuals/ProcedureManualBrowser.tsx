import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getProcedureManualAssignments, listProcedureManualModels, listProcedureManualProcesses, listProcedureMaterials } from '../../../api/client';
import { Input } from '../../../components/ui/Input';
import { AssemblyProcedureSequenceViewer } from '../AssemblyProcedureSequenceViewer';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ProcedureManualAssignmentDialog, procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualBlankDialog } from './ProcedureManualBlankDialog';
import { ProcedureManualModelMatch, ProcedureManualModelTenkey } from './ProcedureManualModelSearch';
import { ProcedureManualPageRail } from './ProcedureManualPageRail';
import { ProcedureMaterialShelfDialog } from './ProcedureMaterialShelfDialog';
import { ProcedurePageVideoStrip } from './ProcedurePageVideoStrip';
import { ProcedureVideoShelfDialog } from './ProcedureVideoShelfDialog';

import type { AssemblyProcedureSequencePageDto, ProcedureManualDetailDto, ProcedureManualModelDto, ProcedureManualProcessDto } from '../types';

export function ProcedureManualBrowser() {
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
  const [blankOpen, setBlankOpen] = useState(false);
  const [models, setModels] = useState<ProcedureManualModelDto[]>([]);
  const [processes, setProcesses] = useState<ProcedureManualProcessDto[]>([]);
  const [modelCodeKey, setModelCodeKey] = useState('');
  const [processId, setProcessId] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ProcedureManualDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoShelfOpen, setVideoShelfOpen] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [materialCount, setMaterialCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void listProcedureMaterials({ state: 'unplaced', limit: 500 }).then((items) => { if (!cancelled) setMaterialCount(items.length); }).catch(() => {});
    return () => { cancelled = true; };
  }, [shelfOpen]);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
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
  }, [version]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setCurrentPage(null);
    setError(null);
    if (!modelCodeKey || !processId) return;
    void getProcedureManualAssignments(modelCodeKey, processId).then((next) => { if (!cancelled) setDetail(next); })
      .catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '要領書を取得できません')); });
    return () => { cancelled = true; };
  }, [modelCodeKey, processId, version]);

  const visibleModels = models.filter((m) => m.modelCodeKey.includes(procedureManualModelKey(search)));
  const currentProcess = processes.find((process) => process.id === processId);
  const navButtonClass = 'min-h-12 w-full rounded-lg px-3 py-2 text-left text-[21px] font-bold hover:bg-[#27313b]';
  const toolClass = 'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[#344252] px-3.5 text-[19px] font-bold disabled:opacity-40';
  return (
    <div className={`grid min-h-0 flex-1 ${listOpen ? 'grid-cols-[760px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'} bg-[#0f1317] text-[#eef3f6]`} data-open={listOpen} data-pages={twoPages ? 2 : 1} data-testid="procedure-manuals-split">
      <div hidden={!listOpen} className={`${listOpen ? 'flex' : 'hidden'} min-h-0 flex-col border-r border-[#27313b] bg-[#161c22]`} data-testid="procedure-manuals-left">
        <header className="grid shrink-0 gap-2 border-b border-[#27313b] px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-2.5 text-2xl font-black tracking-widest">要領書</h1>
            <button className={`${toolClass} border-[#3ba776] bg-[#3ba776] text-[#0b1a12]`} onClick={() => { setBlankOpen(true); }}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>白紙から作る</button>
            <button className={toolClass} onClick={() => setShelfOpen(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l5-5 4 4 3-3 6 6" /></svg>素材 <span className="font-mono font-medium">{materialCount}{materialCount === 500 ? '+' : ''}</span></button>
            <button className={toolClass} onClick={() => setVideoShelfOpen(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="14" height="12" rx="2" /><path d="M17 10l4-2v8l-4-2" /></svg>動画</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={`${toolClass} border-transparent text-[#9fadb9]`} disabled={loading || processes.length === 0} onClick={() => setEditing(true)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h10" /></svg>割り当て</button>
            <Link to="/kiosk/assembly" className={`${toolClass} border-transparent text-[#9fadb9]`}>組立へ戻る</Link>
            <span className="ml-auto min-w-0 text-right text-lg text-[#9fadb9]"><b className="text-[#eef3f6]">{modelCodeKey}</b>{currentProcess ? ` › ${processes.find((process) => process.id === currentProcess.parentId)?.name ?? ''} › ${currentProcess.name}` : ''}</span>
          </div>
        </header>
        {error ? <p role="alert" className="px-3 py-2 text-sm text-red-400">{error}</p> : null}
        <div className="grid min-h-0 flex-1 grid-cols-[440px_minmax(0,1fr)]">
          <section aria-label="機種一覧" className="min-h-0 overflow-auto border-r border-[#27313b] p-3.5">
            <h2 className="mb-3 text-base font-bold tracking-widest text-[#9fadb9]">機種</h2>
            <Input type="search" aria-label="機種検索" placeholder="型番で検索" className="mb-2 h-11 text-xl" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ProcedureManualModelTenkey value={search} onChange={setSearch} />
            {loading ? <p role="status" className="mt-2 text-sm">読込中…</p> : visibleModels.length === 0 ? <p className="mt-2 text-sm text-[#9fadb9]">機種がありません</p> : null}
            {visibleModels.map((model) => <button key={model.modelCodeKey} className={`min-h-12 w-full rounded-lg px-3 py-2 text-left font-bold hover:bg-[#27313b] flex items-start font-mono text-[20px] leading-[1.25] ${modelCodeKey === model.modelCodeKey ? 'bg-[#27313b]' : ''}`} aria-label={model.modelCodeKey} aria-pressed={modelCodeKey === model.modelCodeKey} onClick={() => { setModelCodeKey(model.modelCodeKey); setProcessId(''); }}><span className="min-w-0 break-all"><ProcedureManualModelMatch code={model.modelCodeKey} search={procedureManualModelKey(search)} /></span><span aria-hidden="true" title="選択工程の割り当て件数(未取得は—)" className="ml-auto shrink-0 self-center pl-2.5">{detail && modelCodeKey === model.modelCodeKey ? detail.assignments.length : '—'}</span></button>)}
          </section>
          <section aria-label="工程一覧" className="min-h-0 overflow-auto p-3.5">
            <h2 className="mb-3 text-base font-bold tracking-widest text-[#9fadb9]">工程</h2>
            {!modelCodeKey ? <p className="text-sm text-[#9fadb9]">機種を選択</p> : processes.filter((p) => p.parentId).map((process) => <button key={process.id} className={`${navButtonClass} ${processId === process.id ? 'bg-[#27313b]' : ''}`} aria-pressed={processId === process.id} onClick={() => setProcessId(process.id)}>{processes.find((p) => p.id === process.parentId)?.name} › {process.name}</button>)}
        {detail?.assignments.filter((a) => a.unavailableReason).map((item) => <p key={item.id} role="status" className="p-2 text-sm text-[#f6b93b]">{item.label || `${item.sortOrder + 1}番目の文書`}: {item.unavailableReason === 'no_published_revision' ? '公開版なし' : '文書は無効です'}</p>)}
            {currentPage ? <section aria-label="承認・動画" className="mt-3.5 space-y-2 text-[17px] text-[#9fadb9]">
              <h2 className="text-base font-bold tracking-widest">承認・動画</h2>
              {approval ? <p className="truncate">承認: {approval.employeeName}{approval.positionName ? `(${approval.positionName})` : ''} {new Date(approval.approvedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p> : null}
              <ProcedurePageVideoStrip key={`${currentPage.documentId}:${currentPage.pageIndex}`} videos={currentPage.videos ?? []} layout="manuals" />
            </section> : null}
          </section>
        </div>
      </div>
      <section aria-label="要領書" className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#0a0d10]">
        {!processId ? <p className="p-2 text-sm text-[#9fadb9]">工程を選択</p> : !detail && !error ? <p role="status">読込中…</p> : null}

        {detail && detail.sequence.documents.length > 0 ? <AssemblyProcedureSequenceViewer key={`${modelCodeKey}:${processId}:${version}`} sequence={detail.sequence} layout="manuals" showCurrentMarkerButton={false} onCurrentPageChange={onPageChange} listOpen={listOpen} onToggleList={toggleList} twoPages={twoPages} onToggleTwoPages={() => setTwoPages(!twoPages)} className="min-h-0 flex-1" /> : detail ? <p className="p-2 text-sm text-[#9fadb9]">表示できる文書がありません</p> : null}
        {!detail || detail.sequence.documents.length === 0 ? <ProcedureManualPageRail listOpen={listOpen} onToggleList={toggleList} /> : null}
      </section>
      {blankOpen ? <ProcedureManualBlankDialog models={models} processes={processes} modelCode={modelCodeKey} processId={processId} onClose={() => setBlankOpen(false)} /> : null}
      {videoShelfOpen ? <ProcedureVideoShelfDialog onClose={() => setVideoShelfOpen(false)} /> : null}
      {shelfOpen ? <ProcedureMaterialShelfDialog onClose={() => setShelfOpen(false)} /> : null}
      {editing ? <ProcedureManualAssignmentDialog modelCode={models.find((m) => m.modelCodeKey === modelCodeKey)?.modelCode ?? ''} processId={processId} processes={processes} onClose={() => setEditing(false)} onSaved={(key, id) => { setEditing(false); setModelCodeKey(key); setProcessId(id); setVersion((v) => v + 1); }} /> : null}
    </div>
  );
}
