import { useEffect, useState } from 'react';

import { getProcedureManualAssignments, listProcedureManualPartCandidates, renameAssemblyProcedureDocument, replaceProcedureManualAssignments } from '../../../api/client';
import { Dialog } from '../../../components/ui/Dialog';
import { normalizeWorkInstructionPartNumber } from '../../../lib/workInstructionRules';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureManualButtonBase, procedureManualButtonUnselected } from './procedure-manual-button-styles';
import { buildProcedureManualName } from './procedure-manual-name';
import { ProcedureManualModelTenkey } from './ProcedureManualModelSearch';
import { ProcedureManualPartCandidateButton, useProcedureManualPartScan } from './ProcedureManualPartPicker';

import type { ProcedureManualPartCandidateDto } from '../../../api/client';
import type { ProcedureManualAssignmentDto, ProcedureManualAssignmentOverviewItemDto, ProcedureManualProcessDto } from '../types';

const action = `${procedureManualButtonBase} inline-flex items-center justify-center px-4 text-[19px] font-bold disabled:opacity-40`;
const assignmentInput = (row: ProcedureManualAssignmentDto, sortOrder: number) => ({
  kioskDocumentId: row.kioskDocumentId, assemblyProcedureDocumentId: row.assemblyProcedureDocumentId, label: row.label, sortOrder
});

export function ProcedureManualReattachPartDialog({ item, processes, currentPartName, beforeMutation, onClose, onSaved, onChanged }: {
  item: ProcedureManualAssignmentOverviewItemDto;
  processes: ProcedureManualProcessDto[];
  currentPartName?: string | null;
  beforeMutation: () => boolean;
  onClose: () => void;
  onSaved: (partKey: string, processId: string, message: string) => void;
  onChanged: () => void;
}) {
  const currentKey = normalizeWorkInstructionPartNumber(item.modelCodeKey);
  const child = processes.find(process => process.id === item.processId);
  const parent = processes.find(process => process.id === child?.parentId);
  const [digitQuery, setDigitQuery] = useState('');
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<ProcedureManualPartCandidateDto[]>([]);
  const [selected, setSelected] = useState<ProcedureManualPartCandidateDto | null>(null);
  const [knownCurrentName, setKnownCurrentName] = useState(currentPartName ?? null);
  const [scanArmed, setScanArmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [rename, setRename] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetKey = normalizeWorkInstructionPartNumber(selected?.partNumberKey);
  const name = buildProcedureManualName(targetKey, selected?.partName, parent, child);

  useProcedureManualPartScan('procedure-manual-reattach-part', scanArmed && !busy, key => {
    setScanArmed(false); setDigitQuery(''); setQ(key);
    setSelected(key && key !== currentKey ? { partNumber: key, partNumberKey: key, partName: null, hasManual: false } : null);
  });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setSearchError(null); setCandidates([]);
    void listProcedureManualPartCandidates({ digitQuery, q, limit: 30 }).then(rows => {
      if (cancelled) return;
      const current = rows.find(row => normalizeWorkInstructionPartNumber(row.partNumberKey) === currentKey);
      if (current?.partName) setKnownCurrentName(current.partName);
      setCandidates(rows.filter(row => normalizeWorkInstructionPartNumber(row.partNumberKey) !== currentKey));
      setSelected(value => value ? rows.find(row => normalizeWorkInstructionPartNumber(row.partNumberKey) === normalizeWorkInstructionPartNumber(value.partNumberKey)) ?? value : null);
    }).catch(e => { if (!cancelled) setSearchError(readAssemblyApiErrorMessage(e, '部品を検索できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [digitQuery, q, currentKey]);

  const confirm = async () => {
    if (busy || !targetKey || targetKey === currentKey || loading || (rename && name.length > 200) || !beforeMutation()) return;
    setBusy(true); setScanArmed(false); setError(null);
    let targetAssigned = false;
    let removed = false;
    try {
      const target = await getProcedureManualAssignments(targetKey, item.processId);
      if (!target.assignments.some(row => row.assemblyProcedureDocumentId === item.documentId)) {
        await replaceProcedureManualAssignments(targetKey, item.processId, {
          modelCode: targetKey,
          assignments: [...target.assignments.map(assignmentInput), {
            assemblyProcedureDocumentId: item.documentId, kioskDocumentId: null, label: item.label, sortOrder: target.assignments.length
          }]
        });
      }
      targetAssigned = true;
      // Read the old list after adding; retain its latest root references, labels and unavailable entries.
      const old = await getProcedureManualAssignments(item.modelCodeKey, item.processId);
      if (!old.assignments.some(row => row.id === item.assignmentId)) {
        setError('割り当てが更新されました。もう一度確認してください。新しい部品への割り当ては残っています');
        onChanged();
        return;
      }
      await replaceProcedureManualAssignments(item.modelCodeKey, item.processId, {
        modelCode: item.modelCode,
        assignments: old.assignments.filter(row => row.id !== item.assignmentId).map(assignmentInput)
      });
      removed = true;
      if (rename) await renameAssemblyProcedureDocument(item.documentId, name);
      onSaved(targetKey, item.processId, '付け直しました');
    } catch (e) {
      if (removed) {
        onSaved(targetKey, item.processId, `付け直しました。${readAssemblyApiErrorMessage(e, '名前を変更できません')}`);
      } else if (targetAssigned) {
        setError(`${readAssemblyApiErrorMessage(e, '元の割り当てを外せません')}。新しい部品への割り当ては残っています。元の割り当てをもう一度確認してください`);
        onChanged();
      } else setError(readAssemblyApiErrorMessage(e, '付け直せません'));
    } finally { setBusy(false); }
  };
  return <Dialog isOpen title="部品を付け直す" onClose={() => { if (!busy) onClose(); }} size="full"
    className="!my-auto !max-w-[860px] !rounded-xl !border !border-[#344252] !bg-[#161c22] !px-6 !py-[22px] !text-[#eef3f6]" titleClassName="text-2xl font-bold">
    <form className="mt-4 grid gap-4" onSubmit={event => { event.preventDefault(); void confirm(); }}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate font-mono text-xl font-bold" title={item.title}>{item.title}</span>
        <span className="inline-flex h-[30px] shrink-0 items-center rounded-full border border-[#f6b93b] px-2.5 text-base font-bold text-[#f6b93b]">下書き</span>
      </div>
      <div className="flex flex-wrap items-center gap-3.5 text-xl">
        <div className="flex min-h-[60px] min-w-[230px] flex-col justify-center rounded-lg border border-[#344252] px-4 py-1.5">
          <small className="text-sm tracking-wider text-[#9fadb9]">いま</small><b className="text-[21px]">{knownCurrentName || currentKey}</b>
          {knownCurrentName ? <span className="font-mono text-[15px] text-[#9fadb9]">{currentKey}</span> : null}
        </div><span aria-hidden="true">→</span>
        <div className={`flex min-h-[60px] min-w-[230px] flex-col justify-center rounded-lg border px-4 py-1.5 ${selected ? 'border-[#3ba776]' : 'border-dashed border-[#344252]'}`}>
          <small className="text-sm tracking-wider text-[#9fadb9]">つぎ</small><b className={`text-[21px] ${selected ? '' : 'font-medium text-[#9fadb9]'}`}>{selected ? selected.partName || targetKey : '部品を選ぶ'}</b>
          {selected?.partName ? <span className="font-mono text-[15px] text-[#9fadb9]">{targetKey}</span> : null}
        </div>
      </div>
      <div className="grid gap-[22px] min-[900px]:grid-cols-[244px_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          <button type="button" aria-pressed={scanArmed} disabled={busy} className={`${action} h-[52px] justify-start gap-2.5 border-transparent bg-[#7cc4ff1f] !px-3 !text-lg text-[#7cc4ff]`} onClick={() => setScanArmed(!scanArmed)}>
            <svg aria-hidden="true" className="h-[30px] w-[30px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 9v6M11 9v6M14 9v6M17 9v6" /></svg>移動票をスキャン
          </button>
          <output aria-label="数字検索" className="flex h-[52px] items-center rounded-lg border border-[#344252] bg-[#0b0f13] px-3.5 font-mono text-[26px] tracking-widest">{digitQuery || <span className="font-sans text-[17px] tracking-normal text-[#5f6d7a]">品番の数字</span>}</output>
          <ProcedureManualModelTenkey reattach disabled={busy} value={digitQuery} onChange={value => { setScanArmed(false); setQ(''); setDigitQuery(value); setSelected(null); }} ariaLabel="部品テンキー" />
        </div>
        <section aria-label="部品候補" className="flex h-[388px] flex-col gap-1.5 overflow-auto pr-1">
          {loading ? <p role="status" className="text-[#9fadb9]">検索中…</p> : searchError ? <p role="alert" className="text-red-400">{searchError}</p> : candidates.length === 0 ? <p className="text-[#9fadb9]">該当する部品がありません</p> : null}
          {candidates.map(part => <ProcedureManualPartCandidateButton key={part.partNumberKey} part={part} selected={targetKey === normalizeWorkInstructionPartNumber(part.partNumberKey)} disabled={busy}
            selectedClassName="border-[#3ba776] bg-[#3ba77626]" onSelect={() => { setScanArmed(false); setSelected(part); }} />)}
        </section>
      </div>
      {error ? <p role="alert" className="text-red-400">{error}</p> : null}
      {rename && selected && name.length > 200 ? <p role="alert" className="text-red-400">名前は200文字以内にしてください</p> : null}
      <div className="flex flex-wrap items-center gap-3.5 border-t border-[#27313b] pt-4">
        <label className="flex min-h-12 cursor-pointer items-center gap-2.5 text-lg"><input type="checkbox" checked={rename} disabled={busy} onChange={event => setRename(event.target.checked)} className="h-[26px] w-[26px] accent-[#3ba776]" />名前も変える</label>
        <output aria-label="名前のプレビュー" className="min-w-0 flex-1 truncate font-mono text-base text-[#9fadb9]" title={selected && rename ? name : undefined}>{selected && rename ? name : ''}</output>
        <div className="ml-auto flex gap-2.5"><button type="button" className={`${action} ${procedureManualButtonUnselected}`} disabled={busy} onClick={onClose}>やめる</button>
          <button type="submit" className={`${action} border-[#3ba776] bg-[#3ba776] text-[#0b1a12]`} disabled={busy || !targetKey || targetKey === currentKey || loading || (rename && name.length > 200)}>付け直す</button></div>
      </div>
    </form>
  </Dialog>;
}
