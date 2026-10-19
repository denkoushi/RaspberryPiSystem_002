import { deriveProcedureManualKanaRow, normalizeProcedureManualCommonSubject, PROCEDURE_MANUAL_KANA_ROWS } from '@raspi-system/shared-types';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createProcedureManualCommon, deleteProcedureManualCommonChoice, saveProcedureManualCommonChoice } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Dialog } from '../../../components/ui/Dialog';
import { kioskAssemblyManualsWorkshopPath, kioskAssemblyProcedureDocumentEditPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureManualButtonBase, procedureManualButtonUnselected, procedureManualCommonSelected, procedureManualKanaSelected } from './procedure-manual-button-styles';

import type { ProcedureManualAssignmentOverviewItemDto, ProcedureManualCommonCatalogDto } from '../types';

export function ProcedureManualCommonDialog({ catalog, items, categoryId, onClose, onChanged, onFix, beforeMutation }: {
  catalog: ProcedureManualCommonCatalogDto; items: ProcedureManualAssignmentOverviewItemDto[]; categoryId: string;
  onClose: () => void; onChanged: () => Promise<void>; onFix: (item: ProcedureManualAssignmentOverviewItemDto) => void; beforeMutation: () => boolean;
}) {
  const navigate = useNavigate();
  const [category, setCategory] = useState(categoryId);
  const [target, setTarget] = useState('');
  const [actionId, setActionId] = useState('');
  const [reading, setReading] = useState('');
  const [editing, setEditing] = useState<'categories' | 'actions' | null>(null);
  const [selected, setSelected] = useState('');
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const key = normalizeProcedureManualCommonSubject(target);
  const known = catalog.subjects.find(row => row.key === key);
  const kanaRow = deriveProcedureManualKanaRow(target) ?? known?.kanaRow ?? reading;
  const action = catalog.actions.find(row => row.id === actionId);
  const duplicate = items.find(row => row.processId === category && row.modelCodeKey === key && row.label === action?.name);
  const similar = key ? items.filter(row => row.modelCodeKey.includes(key) || key.includes(row.modelCodeKey)) : category ? items.filter(row => row.processId === category) : [];
  const choices = editing === 'categories' ? catalog.categories : catalog.actions;
  const selectedChoice = choices.find(row => row.id === selected);
  const chip = (pressed: boolean) => `${procedureManualButtonBase} min-h-[52px] px-[18px] text-[19px] font-bold ${pressed ? procedureManualCommonSelected : procedureManualButtonUnselected}`;
  const inputClass = 'h-14 w-full rounded-lg border border-[#344252] bg-[#0b0f13] px-4 text-xl text-[#eef3f6]';
  const changeEdit = (kind: 'categories' | 'actions') => { setEditing(kind); setSelected(''); setEditName(''); setEditError(null); };
  const mutate = async (remove = false) => {
    if (!editing || busy || !beforeMutation()) return;
    setBusy(true); setEditError(null);
    try {
      if (remove) {
        await deleteProcedureManualCommonChoice(editing, selected);
        if (editing === 'categories' && category === selected) setCategory('');
        if (editing === 'actions' && actionId === selected) setActionId('');
      } else await saveProcedureManualCommonChoice(editing, editName.trim(), selected || undefined);
      await onChanged(); setSelected(''); setEditName('');
    } catch (e) { setEditError(readAssemblyApiErrorMessage(e, '変更できません')); }
    finally { setBusy(false); }
  };
  const renderChoices = (kind: 'categories' | 'actions', title: string) => <section aria-label={title} className="grid gap-2">
    <h3 className="flex items-center text-base font-semibold tracking-wider text-[#9fadb9]">{title}{!editing ? <button type="button" aria-label={`${title}を編集`} className={`${procedureManualButtonBase} ml-2.5 !min-h-11 px-3.5 text-base text-[#7cc4ff] ${procedureManualButtonUnselected}`} onClick={() => changeEdit(kind)}>編集</button> : null}</h3>
    <div className="flex max-h-[160px] flex-wrap gap-2 overflow-auto">{(kind === 'categories' ? catalog.categories : catalog.actions).map(row => {
      const pressed = editing === kind ? selected === row.id : (kind === 'categories' ? category : actionId) === row.id;
      return <button key={row.id} type="button" disabled={busy} aria-pressed={pressed} className={chip(pressed)} onClick={() => {
        if (editing === kind) { setSelected(pressed ? '' : row.id); setEditName(pressed ? '' : row.name); setEditError(null); }
        else if (kind === 'categories') setCategory(row.id); else setActionId(row.id);
      }}>{row.name}</button>;
    })}</div>
    {editing === kind ? <><div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2">
      <input aria-label={`${title}の名前`} placeholder="名前" maxLength={20} value={editName} className={inputClass} onChange={event => setEditName(event.target.value)} />
      <button type="button" className={chip(false)} disabled={busy || !editName.trim()} onClick={() => void mutate()}>{selected ? '変更' : '追加'}</button>
      <button type="button" className={chip(false)} disabled={busy || !selectedChoice || selectedChoice.inUse} onClick={() => setDeleting(true)}>削除</button>
      <button type="button" className={chip(true)} disabled={busy} onClick={() => { setEditing(null); setEditError(null); }}>完了</button>
    </div>{editError ? <p role="alert" className="text-[#ff8a80]">{editError}</p> : null}</> : null}
  </section>;
  const create = async () => {
    if (busy || duplicate || !category || !key || !action || !kanaRow || !beforeMutation()) return;
    setBusy(true); setError(null);
    try {
      const document = await createProcedureManualCommon({ categoryId: category, target: target.trim(), actionId, kanaRow });
      navigate(kioskAssemblyProcedureDocumentEditPath(document.id), { state: {
        returnTo: kioskAssemblyManualsWorkshopPath({ common: '1', process: category }),
        context: { modelCode: document.modelCode, modelCodeKey: document.modelCodeKey, processId: category,
          processName: `共通 › ${catalog.categories.find(row => row.id === category)?.name ?? ''}`, mode: 'make' }
      } });
    } catch (e) { setError(readAssemblyApiErrorMessage(e, '作成できません')); }
    finally { setBusy(false); }
  };
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} title="共通の手順を作る" size="full" className="!my-auto !max-w-[1180px] !rounded-xl !border !border-[#344252] !bg-[#161c22] !px-7 !py-6 !text-[#eef3f6]" titleClassName="!text-[26px] !font-bold text-[#eef3f6]">
    <form className="mt-4 grid gap-4" onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className="grid grid-cols-[minmax(0,1fr)_430px] gap-7">
        <div className="grid content-start gap-3.5">
          {renderChoices('categories', '分類')}
          <h3 className="text-base font-semibold tracking-wider text-[#9fadb9]">対象</h3>
          <input aria-label="対象" placeholder="工具・設備の名前" maxLength={179} value={target} className={inputClass} onChange={event => { setTarget(event.target.value); setReading(''); }} />
          <div className="flex max-h-[112px] flex-wrap gap-2 overflow-auto">{catalog.subjects.filter(row => !category || row.categoryIds.includes(category)).map(row => <button key={row.key} type="button" aria-pressed={key === row.key} className={chip(key === row.key)} onClick={() => { setTarget(row.name); setReading(''); }}>{row.name}</button>)}</div>
          {key && !deriveProcedureManualKanaRow(target) && !known?.kanaRow ? <section aria-label="よみ" className="grid gap-2"><h3 className="text-base text-[#9fadb9]">よみ</h3><div className="grid grid-cols-10 gap-1.5">{PROCEDURE_MANUAL_KANA_ROWS.map(row => <button key={row} type="button" aria-pressed={reading === row} className={`${procedureManualButtonBase} h-[52px] text-xl ${reading === row ? procedureManualKanaSelected : procedureManualButtonUnselected}`} onClick={() => setReading(row)}>{row}</button>)}</div></section> : null}
          {renderChoices('actions', '作業')}
        </div>
        <section aria-label="似た手順" className="flex min-h-0 flex-col gap-2"><h3 className="text-base font-semibold tracking-wider text-[#9fadb9]">似た手順 {similar.length}</h3>
          <div className="grid max-h-[520px] min-h-[330px] content-start gap-2 overflow-auto rounded-lg border border-[#27313b] p-3">{similar.map(row => <div key={row.assignmentId} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border px-3 py-2 text-lg ${duplicate?.assignmentId === row.assignmentId ? 'border-[#ff8a80]' : 'border-[#344252]'}`}><span className="min-w-0"><b className="block truncate">{row.title}</b><span className="text-base text-[#9fadb9]">{row.category}・{row.status === 'published' ? '公開' : '下書き'}</span></span><button type="button" className={`${procedureManualButtonBase} border-[#7cc4ff] px-4 text-[17px] font-bold text-[#7cc4ff]`} disabled={busy || row.kind !== 'assembly_procedure_document'} onClick={() => { onClose(); onFix(row); }}>これを直す</button></div>)}{!similar.length ? <span className="text-base text-[#9fadb9]">まだありません</span> : null}</div>
        </section>
      </div>
      {error ? <p role="alert" className="text-[#ff8a80]">{error}</p> : null}
      <footer className="flex items-center gap-3.5 border-t border-[#27313b] pt-4">
        <output aria-label="名前のプレビュー" className="min-w-0 flex-1 truncate font-mono text-xl text-[#9fadb9]">{key && action ? `${target.trim()}_${action.name}` : ''}</output>
        {duplicate ? <span role="alert" className="text-[17px] font-bold text-[#ff8a80]">同じ手順があります</span> : null}
        <button type="button" disabled={busy} className={`${procedureManualButtonBase} h-14 px-[22px] text-xl font-bold ${procedureManualButtonUnselected}`} onClick={onClose}>やめる</button>
        <button type="submit" className={`${procedureManualButtonBase} h-14 border-[#3ba776] bg-[#3ba776] px-[26px] text-xl font-extrabold text-[#0b1a12] disabled:opacity-[.35]`} disabled={busy || !!editing || !!duplicate || !category || !key || !action || !kanaRow}>作ってエディタへ</button>
      </footer>
    </form>
    <ConfirmDialog isOpen={deleting} title={`${editing === 'categories' ? '分類' : '作業'}を削除`} description={selectedChoice?.name} confirmLabel="削除" buttonClassName="min-h-12" onCancel={() => setDeleting(false)} onConfirm={() => { setDeleting(false); void mutate(true); }} />
  </Dialog>;
}
