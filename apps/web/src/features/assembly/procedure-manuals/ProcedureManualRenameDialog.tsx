import { useEffect, useRef, useState } from 'react';

import { renameAssemblyProcedureDocument } from '../../../api/client';
import { Dialog } from '../../../components/ui/Dialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureManualButtonBase, procedureManualButtonUnselected } from './procedure-manual-button-styles';
import { joinProcedureManualName } from './procedure-manual-name';

import type { ProcedureManualAssignmentOverviewItemDto } from '../types';

const action = `${procedureManualButtonBase} inline-flex items-center justify-center px-4 text-[19px] font-bold disabled:opacity-40`;
const chip = 'inline-flex min-h-11 min-w-0 items-center truncate rounded-lg border border-[#344252] px-3.5 text-xl text-[#eef3f6]';
const input = 'h-14 w-full min-w-0 rounded-lg border border-[#344252] bg-white px-3.5 text-[22px] text-[#0f1317] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] disabled:opacity-60';

export function ProcedureManualRenameDialog({ item, name, onClose, onSaved }: {
  item: ProcedureManualAssignmentOverviewItemDto;
  /** The row's current split name (品名・品番・工程・作業・補足). */
  name: { partName: string; subjectKey: string; process: string; work: string; supplement: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const currentName = item.label || item.title;
  const [partName, setPartName] = useState(name.partName);
  const [supplement, setSupplement] = useState(name.supplement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partNameRef = useRef<HTMLInputElement>(null);
  const composed = joinProcedureManualName([partName, name.subjectKey, name.process, name.work, supplement]);
  const tooLong = composed.length > 200;
  const canSave = !busy && Boolean(partName.trim()) && composed !== currentName && !tooLong;
  useEffect(() => { partNameRef.current?.select(); }, []);

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setError(null);
    try {
      await renameAssemblyProcedureDocument(item.documentId, composed);
      onSaved();
    } catch (e) { setError(readAssemblyApiErrorMessage(e, '名前を変更できません')); }
    finally { setBusy(false); }
  };
  return <Dialog isOpen ariaLabel="名前を変える" onClose={() => { if (!busy) onClose(); }} size="full" initialFocusRef={partNameRef}
    className="!my-auto !max-w-[860px] overflow-y-auto !rounded-xl !border !border-[#344252] !bg-[#161c22] !px-[26px] !py-[22px] !text-[#eef3f6]">
    <form className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="shrink-0 text-2xl font-bold">名前を変える</h2>
        <span className={`inline-flex h-[30px] shrink-0 items-center rounded-full border px-2.5 text-base font-bold ${item.status === 'published' ? 'border-[#3ba776] text-[#3ba776]' : 'border-[#f6b93b] text-[#f6b93b]'}`}>
          {item.status === 'published' ? item.publishedRevisionNumber == null ? '公開' : `公開 第${item.publishedRevisionNumber}版` : '下書き'}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-3">
        <span className={`${chip} font-mono font-bold`}>{name.subjectKey}</span>
        <span className={chip}>{name.process}</span>
        <span className={chip}>{name.work}</span>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-4">
        <label className="grid gap-1.5 text-base font-bold text-[#9fadb9]">品名
          <input ref={partNameRef} value={partName} disabled={busy} onChange={event => setPartName(event.target.value)} className={input} />
        </label>
        <label className="grid gap-1.5 text-base font-bold text-[#9fadb9]">補足
          <input value={supplement} disabled={busy} onChange={event => setSupplement(event.target.value)} className={input} />
        </label>
      </div>
      {error ? <p role="alert" className="text-red-400">{error}</p> : null}
      {tooLong ? <p role="alert" className="text-red-400">名前は200文字以内にしてください</p> : null}
      <div className="flex justify-end gap-2.5 border-t border-[#27313b] pt-4">
        <button type="button" className={`${action} ${procedureManualButtonUnselected}`} disabled={busy} onClick={onClose}>やめる</button>
        <button type="submit" className={`${action} border-[#3ba776] bg-[#3ba776] text-[#0b1a12]`} disabled={!canSave}>保存</button>
      </div>
    </form>
  </Dialog>;
}
