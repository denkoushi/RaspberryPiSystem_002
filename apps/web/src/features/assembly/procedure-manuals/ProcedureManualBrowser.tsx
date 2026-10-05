import { useEffect, useState } from 'react';

import { getProcedureManualAssignments, listProcedureManualModels, listProcedureManualProcesses } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { AssemblyProcedureSequenceViewer } from '../AssemblyProcedureSequenceViewer';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ProcedureManualAssignmentDialog, procedureManualModelKey } from './ProcedureManualAssignmentDialog';

import type { ProcedureManualDetailDto, ProcedureManualModelDto, ProcedureManualProcessDto } from '../types';

export function ProcedureManualBrowser() {
  const [models, setModels] = useState<ProcedureManualModelDto[]>([]);
  const [processes, setProcesses] = useState<ProcedureManualProcessDto[]>([]);
  const [modelCodeKey, setModelCodeKey] = useState('');
  const [processId, setProcessId] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ProcedureManualDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);

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
    setError(null);
    if (!modelCodeKey || !processId) return;
    void getProcedureManualAssignments(modelCodeKey, processId).then((next) => { if (!cancelled) setDetail(next); })
      .catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '要領書を取得できません')); });
    return () => { cancelled = true; };
  }, [modelCodeKey, processId, version]);

  const visibleModels = models.filter((m) => m.modelCodeKey.includes(procedureManualModelKey(search)));
  const navButtonClass = 'min-h-11 w-full rounded-md px-3 py-2 text-left text-sm font-bold hover:bg-[#27313b]';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 justify-end border-b border-[#27313b] px-3 py-2">
        <Button variant="ghostOnDark" className="min-h-11 text-sm" disabled={loading || processes.length === 0} onClick={() => setEditing(true)}>割り当てを編集</Button>
      </div>
      {error ? <p role="alert" className="px-3 py-2 text-sm text-red-400">{error}</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[13rem_15rem_minmax(0,1fr)] lg:overflow-hidden">
        <section aria-label="機種一覧" className="min-h-0 overflow-auto border-r border-[#27313b] p-3">
          <h2 className="mb-2 text-sm font-bold">機種</h2>
          <Input aria-label="機種検索" placeholder="型番で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
          {loading ? <p role="status" className="mt-2 text-sm">読込中…</p> : visibleModels.length === 0 ? <p className="mt-2 text-sm text-[#9fadb9]">機種がありません</p> : null}
          {visibleModels.map((model) => <button key={model.modelCodeKey} className={`${navButtonClass} ${modelCodeKey === model.modelCodeKey ? 'bg-[#27313b]' : ''}`} aria-pressed={modelCodeKey === model.modelCodeKey} onClick={() => { setModelCodeKey(model.modelCodeKey); setProcessId(''); }}>{model.modelCodeKey}</button>)}
        </section>
        <section aria-label="工程一覧" className="min-h-0 overflow-auto border-r border-[#27313b] p-3">
          <h2 className="mb-2 text-sm font-bold">工程</h2>
          {!modelCodeKey ? <p className="text-sm text-[#9fadb9]">機種を選択</p> : processes.filter((p) => p.parentId).map((process) => <button key={process.id} className={`${navButtonClass} ${processId === process.id ? 'bg-[#27313b]' : ''}`} aria-pressed={processId === process.id} onClick={() => setProcessId(process.id)}>{processes.find((p) => p.id === process.parentId)?.name} &gt; {process.name}</button>)}
        </section>
        <section aria-label="要領書" className="flex min-h-80 min-w-0 flex-col overflow-hidden p-2 lg:min-h-0">
          {!processId ? <p className="p-2 text-sm text-[#9fadb9]">工程を選択</p> : !detail && !error ? <p role="status">読込中…</p> : null}
          {detail?.assignments.filter((a) => a.unavailableReason).map((item) => <p key={item.id} role="status" className="p-2 text-sm text-[#f6b93b]">{item.label || `${item.sortOrder + 1}番目の文書`}: {item.unavailableReason === 'no_published_revision' ? '公開版なし' : '文書は無効です'}</p>)}
          {detail && detail.sequence.documents.length > 0 ? <AssemblyProcedureSequenceViewer key={`${modelCodeKey}:${processId}:${version}`} sequence={detail.sequence} className="min-h-0 flex-1" /> : detail ? <p className="p-2 text-sm text-[#9fadb9]">表示できる文書がありません</p> : null}
        </section>
      </div>
      {editing ? <ProcedureManualAssignmentDialog modelCode={models.find((m) => m.modelCodeKey === modelCodeKey)?.modelCode ?? ''} processId={processId} processes={processes} onClose={() => setEditing(false)} onSaved={(key, id) => { setEditing(false); setModelCodeKey(key); setProcessId(id); setVersion((v) => v + 1); }} /> : null}
    </div>
  );
}
