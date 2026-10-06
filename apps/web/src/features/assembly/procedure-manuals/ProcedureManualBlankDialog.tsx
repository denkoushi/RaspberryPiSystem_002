import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createBlankAssemblyProcedureDocument, listAssemblyMachineNameCandidates } from '../../../api/client';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureManualModelKey } from './ProcedureManualAssignmentDialog';
import { ProcedureManualModelMatch, ProcedureManualModelTenkey } from './ProcedureManualModelSearch';

import type { ProcedureManualModelDto, ProcedureManualProcessDto } from '../types';

const shortName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';

export function ProcedureManualBlankDialog({ processes, modelCode, processId, onClose }: {
  models: ProcedureManualModelDto[]; processes: ProcedureManualProcessDto[]; modelCode: string; processId: string; onClose: () => void;
}) {
  const navigate = useNavigate();
  const initialChild = processes.find(process => process.id === processId && process.parentId);
  const initialParent = initialChild?.parentId ?? processes.find(process => process.id === 'procedure-manual-assembly')?.id ?? processes.find(process => !process.parentId)?.id ?? '';
  const [modelSearch, setModelSearch] = useState(modelCode);
  const [digitQuery, setDigitQuery] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const [selectedModel, setSelectedModel] = useState(procedureManualModelKey(modelCode));
  const [parentId, setParentId] = useState(initialParent);
  const [childId, setChildId] = useState(initialChild?.id ?? processes.find(process => process.parentId === initialParent)?.id ?? '');
  const [supplement, setSupplement] = useState('');
  const [direct, setDirect] = useState(false);
  const [directName, setDirectName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parent = processes.find(process => process.id === parentId);
  const child = processes.find(process => process.id === childId);
  const builtName = [selectedModel, shortName(parent), shortName(child), supplement.trim()].filter(Boolean).join('_');
  const name = direct ? directName.trim() : builtName;
  const canCreate = Boolean(name && name.length <= 200 && (direct || (selectedModel && parent && child)));
  const searchKey = digitQuery || procedureManualModelKey(modelSearch);
  useEffect(() => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setSearchError(null);
    setCandidates([]);
    setHasMore(false);
    void listAssemblyMachineNameCandidates({ digitQuery, q: modelSearch, limit: 30 })
      .then(result => {
        if (sequence !== requestSequence.current) return;
        setCandidates([...new Set(result.candidates.map(procedureManualModelKey))]);
        setHasMore(result.hasMore);
      })
      .catch(() => {
        if (sequence !== requestSequence.current) return;
        setSearchError('機種を検索できませんでした');
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
    return () => { requestSequence.current += 1; };
  }, [digitQuery, modelSearch]);
  const chip = (pressed: boolean) => `min-h-12 rounded-full border px-4 text-xl font-bold ${pressed ? 'border-[#3ba776] bg-[#3ba776] text-[#0b1a12]' : 'border-[#6b7c8d] bg-[#27313b] text-[#eef3f6]'}`;
  const changeSearch = (value: string) => { setModelSearch(value); setSelectedModel(''); };
  const changeDigits = (value: string) => { setDigitQuery(value); setSelectedModel(''); };
  const action = 'min-h-[52px] rounded-[10px] border px-[22px] text-[21px] font-bold disabled:opacity-40';
  const secondaryAction = `${action} border-[#6b7c8d] text-[#eef3f6]`;
  const create = async () => {
    if (busy || !canCreate) return;
    setBusy(true); setError(null);
    try {
      const assignment = selectedModel && child ? { modelCode: selectedModel, processId: child.id } : undefined;
      const document = await createBlankAssemblyProcedureDocument(name, assignment);
      navigate(`/kiosk/assembly/procedure-documents/${document.id}/edit`, { state: { procedureManualAssignmentError: document.assignmentError } });
    } catch (e) { setError(readAssemblyApiErrorMessage(e, '白紙の要領書を作成できません')); }
    finally { setBusy(false); }
  };
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} title="白紙から作る" size="full" className="my-auto max-w-[1180px] rounded-[14px] border border-[#344252] bg-[#161c22] px-[26px] py-6 text-[#eef3f6]" titleClassName="text-2xl font-black">
    <form className="mt-[18px] grid gap-[18px]" onSubmit={event => { event.preventDefault(); void create(); }}>
      {direct ? <label className="grid gap-2">要領書名<Input aria-label="要領書名" autoFocus maxLength={200} value={directName} onChange={event => setDirectName(event.target.value)} className="h-12 text-xl" /></label> : <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3">
        <section aria-label="機種の選択" className="grid content-start gap-2">
          <h3 className="font-bold tracking-wider text-[#9fadb9]">機種</h3>
          <Input type="search" aria-label="型番で検索" placeholder="型番で検索" autoFocus maxLength={120} value={modelSearch} onChange={event => changeSearch(event.target.value)} className="h-12 text-xl" />
          <output aria-label="数字検索" className="min-h-8 text-xl text-[#eef3f6]">数字: {digitQuery || '未指定'}</output>
          <ProcedureManualModelTenkey value={digitQuery} onChange={changeDigits} />
          {loading ? <p role="status" className="text-[#9fadb9]">検索中…</p> : searchError ? <p role="alert" className="text-red-400">{searchError}</p> : candidates.length === 0 ? <p className="text-[#9fadb9]">該当する機種がありません</p> : null}
          <div className="grid max-h-[220px] gap-1.5 overflow-auto pr-1">{candidates.map(code => <button key={code} type="button" aria-label={code} aria-pressed={selectedModel === code} className={`min-h-[46px] rounded-lg px-3 text-left font-mono text-xl break-all hover:bg-[#27313b] ${selectedModel === code ? 'bg-[#27313b]' : ''}`} onClick={() => setSelectedModel(code)}><ProcedureManualModelMatch code={code} search={searchKey} /></button>)}</div>
          {hasMore ? <p className="text-[#9fadb9]">他にも候補があります。数字を追加してください</p> : null}
        </section>
        <section aria-label="工程と細分の選択" className="grid content-start gap-2">
          <h3 className="font-bold tracking-wider text-[#9fadb9]">工程</h3>
          <div className="flex flex-wrap gap-2">{processes.filter(process => !process.parentId).map(process => <button type="button" key={process.id} className={chip(parentId === process.id)} aria-pressed={parentId === process.id} onClick={() => { setParentId(process.id); setChildId(processes.find(child => child.parentId === process.id)?.id ?? ''); }}>{shortName(process)}</button>)}</div>
          <h3 className="mt-2 font-bold tracking-wider text-[#9fadb9]">細分</h3>
          <div className="flex flex-wrap gap-2">{processes.filter(process => process.parentId === parentId).map(process => <button type="button" key={process.id} className={chip(childId === process.id)} aria-pressed={childId === process.id} onClick={() => setChildId(process.id)}>{shortName(process)}</button>)}</div>
        </section>
        <section aria-label="補足の入力" className="grid content-start gap-2">
          <h3 className="font-bold tracking-wider text-[#9fadb9]">補足(任意)</h3>
          <Input aria-label="補足" placeholder="例: ベアリング圧入" maxLength={200} value={supplement} onChange={event => setSupplement(event.target.value)} className="h-12 text-xl" />
          <h3 className="mt-2 font-bold tracking-wider text-[#9fadb9]">よく使う</h3>
          <div className="flex flex-wrap gap-2">{['圧入', '配線', '最終確認'].map(value => <button key={value} type="button" aria-pressed={supplement === value} className={`${chip(supplement === value)} border-dashed`} onClick={() => setSupplement(value)}>{value}</button>)}</div>
        </section>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-3.5 rounded-[10px] border border-[#27313b] bg-[#1b222a] px-4 py-3.5">
        <div className="min-w-0"><output aria-label="名前のプレビュー" className="break-all text-[26px] font-black text-[#eef3f6]">{name || '型番_工程_細分'}</output><p className="mt-1 text-[15px] text-[#9fadb9]">保存名: {name || '未選択'} ・ 同名があれば末尾に -2</p></div>
        <button type="button" className={secondaryAction} onClick={() => { if (!direct) setDirectName(builtName); setDirect(!direct); }}>{direct ? '名前の組み立てに戻る' : '名前を直接入力'}</button>
      </div>
      {error ? <p role="alert" className="text-red-400">{error}</p> : null}
      {name.length > 200 ? <p role="alert" className="text-red-400">名前は200文字以内にしてください</p> : null}
      <div className="flex justify-end gap-2.5"><button type="button" className={secondaryAction} disabled={busy} onClick={onClose}>閉じる</button><button type="submit" className={`${action} border-[#3ba776] bg-[#3ba776] text-[#0b1a12]`} disabled={busy || !canCreate}>{busy ? '作成中…' : '作成してエディタへ'}</button></div>
    </form>
  </Dialog>;
}
