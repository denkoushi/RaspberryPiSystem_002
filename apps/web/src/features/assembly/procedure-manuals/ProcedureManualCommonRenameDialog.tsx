import { deriveProcedureManualKanaRow, normalizeProcedureManualCommonSubject, PROCEDURE_MANUAL_KANA_ROWS } from '@raspi-system/shared-types';
import { useEffect, useRef, useState } from 'react';

import { renameProcedureManualCommonTarget } from '../../../api/client';
import { Dialog } from '../../../components/ui/Dialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureManualButtonBase, procedureManualButtonUnselected, procedureManualKanaSelected } from './procedure-manual-button-styles';

import type { ProcedureManualAssignmentOverviewItemDto, ProcedureManualCommonCatalogDto } from '../types';

const action = `${procedureManualButtonBase} inline-flex items-center justify-center px-4 text-[19px] font-bold disabled:opacity-40`;
const chip = 'inline-flex min-h-11 min-w-0 items-center truncate rounded-lg border border-[#344252] px-3.5 text-xl text-[#eef3f6]';
const input = 'h-14 w-full min-w-0 rounded-lg border border-[#344252] bg-white px-3.5 text-[22px] text-[#0f1317] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] disabled:opacity-60';

function currentTarget(item: ProcedureManualAssignmentOverviewItemDto) {
  if (item.target) return item.target;
  const index = item.title.lastIndexOf('_');
  return index > 0 ? item.title.slice(0, index) : item.title;
}

export function ProcedureManualCommonRenameDialog({ item, catalog, onClose, onSaved }: {
  item: ProcedureManualAssignmentOverviewItemDto; catalog: ProcedureManualCommonCatalogDto;
  onClose: () => void; onSaved: () => void;
}) {
  const label = item.label ?? '';
  const original = currentTarget(item);
  const [target, setTarget] = useState(original);
  const [reading, setReading] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetRef = useRef<HTMLInputElement>(null);
  const trimmed = target.trim();
  const key = normalizeProcedureManualCommonSubject(trimmed);
  const known = catalog.subjects.find(row => row.key === key);
  const needsReading = Boolean(key) && !deriveProcedureManualKanaRow(trimmed) && !known?.kanaRow;
  const tooLong = trimmed.length > 179 || `${trimmed}_${label}`.length > 200;
  const canSave = !busy && Boolean(key) && trimmed !== original && (!needsReading || Boolean(reading)) && !tooLong;
  useEffect(() => { targetRef.current?.select(); }, []);

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setError(null);
    try {
      await renameProcedureManualCommonTarget(item.assignmentId, { target: trimmed, ...(needsReading ? { kanaRow: reading } : {}) });
      onSaved();
    } catch (e) { setError(readAssemblyApiErrorMessage(e, '名前を変更できません')); }
    finally { setBusy(false); }
  };
  return <Dialog isOpen ariaLabel="名前を変える" onClose={() => { if (!busy) onClose(); }} size="full" initialFocusRef={targetRef}
    className="!my-auto !max-w-[860px] overflow-y-auto !rounded-xl !border !border-[#344252] !bg-[#161c22] !px-[26px] !py-[22px] !text-[#eef3f6]">
    <form className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="shrink-0 text-2xl font-bold">名前を変える</h2>
        <span className={`inline-flex h-[30px] shrink-0 items-center rounded-full border px-2.5 text-base font-bold ${item.status === 'published' ? 'border-[#3ba776] text-[#3ba776]' : 'border-[#f6b93b] text-[#f6b93b]'}`}>
          {item.status === 'published' ? item.publishedRevisionNumber == null ? '公開' : `公開 第${item.publishedRevisionNumber}版` : '下書き'}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-3"><span className={chip}>{label}</span></div>
      <label className="grid gap-1.5 text-base font-bold text-[#9fadb9]">対象
        <input ref={targetRef} value={target} maxLength={179} disabled={busy} onChange={event => { setTarget(event.target.value); setReading(''); }} className={input} />
      </label>
      {needsReading ? <section aria-label="よみ" className="grid gap-2"><h3 className="text-base text-[#9fadb9]">よみ</h3><div className="grid grid-cols-10 gap-1.5">{PROCEDURE_MANUAL_KANA_ROWS.map(row => <button key={row} type="button" disabled={busy} aria-pressed={reading === row} className={`${procedureManualButtonBase} h-[52px] text-xl ${reading === row ? procedureManualKanaSelected : procedureManualButtonUnselected}`} onClick={() => setReading(row)}>{row}</button>)}</div></section> : null}
      {error ? <p role="alert" className="text-red-400">{error}</p> : null}
      {tooLong ? <p role="alert" className="text-red-400">名前は200文字以内にしてください</p> : null}
      <div className="flex justify-end gap-2.5 border-t border-[#27313b] pt-4">
        <button type="button" className={`${action} ${procedureManualButtonUnselected}`} disabled={busy} onClick={onClose}>やめる</button>
        <button type="submit" className={`${action} border-[#3ba776] bg-[#3ba776] text-[#0b1a12]`} disabled={!canSave}>保存</button>
      </div>
    </form>
  </Dialog>;
}
