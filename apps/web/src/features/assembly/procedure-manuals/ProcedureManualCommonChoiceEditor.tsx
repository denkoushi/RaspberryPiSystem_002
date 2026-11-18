import { useState } from 'react';

import { deleteProcedureManualCommonChoice, saveProcedureManualCommonChoice } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureManualButtonBase, procedureManualButtonUnselected, procedureManualCommonChip, procedureManualCommonInput } from './procedure-manual-button-styles';

import type { ProcedureManualCommonCatalogDto } from '../types';
import type { ReactNode } from 'react';

type Kind = 'categories' | 'actions';

export function ProcedureManualCommonChoiceEditor({
  kind, choices, children, beforeMutation, onChanged, onDeleted, onEditingChange, onBusyChange, disabled
}: {
  kind: Kind;
  choices: ProcedureManualCommonCatalogDto[Kind];
  children: ReactNode;
  beforeMutation: () => boolean;
  onChanged: () => Promise<void>;
  onDeleted: (id: string) => void;
  onEditingChange?: (editing: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedChoice = choices.find(row => row.id === selected);
  const isCategory = kind === 'categories';
  const title = isCategory ? '分類' : '作業';
  const Heading = isCategory ? 'h2' : 'h3';

  const changeEditing = (value: boolean) => {
    setEditing(value);
    setSelected('');
    setName('');
    setError(null);
    onEditingChange?.(value);
  };

  const mutate = async (remove = false) => {
    if (busy || (remove ? !selectedChoice || selectedChoice.inUse : !name.trim()) || !beforeMutation()) return;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      if (remove) {
        await deleteProcedureManualCommonChoice(kind, selected);
        onDeleted(selected);
      } else {
        await saveProcedureManualCommonChoice(kind, name.trim(), selected || undefined);
      }
      await onChanged();
      setSelected('');
      setName('');
    } catch (e) {
      setError(readAssemblyApiErrorMessage(e, '変更できません'));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return <section aria-label={title} className={isCategory ? 'flex max-h-[calc(40%+60px)] min-h-0 flex-col gap-4' : 'grid gap-2'}>
    <Heading className={`flex shrink-0 items-center text-base text-[#9fadb9] ${isCategory ? 'font-bold tracking-widest' : 'font-semibold tracking-wider'}`}>
      {title}{!editing ? <button type="button" aria-label={`${title}を編集`} disabled={disabled} className={`${procedureManualButtonBase} ml-2.5 !min-h-11 px-3.5 text-base text-[#7cc4ff] ${procedureManualButtonUnselected}`} onClick={() => changeEditing(true)}>編集</button> : null}
    </Heading>
    {editing ? <>
      <div className="flex max-h-[160px] min-h-0 flex-wrap gap-2 overflow-auto">{choices.map(row => {
        const pressed = selected === row.id;
        return <button key={row.id} type="button" disabled={busy} aria-pressed={pressed} className={procedureManualCommonChip(pressed)} onClick={() => {
          setSelected(pressed ? '' : row.id);
          setName(pressed ? '' : row.name);
          setError(null);
        }}>{row.name}</button>;
      })}</div>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2">
        <input aria-label={`${title}の名前`} placeholder="名前" maxLength={20} value={name} className={procedureManualCommonInput} onChange={event => setName(event.target.value)} />
        <button type="button" className={procedureManualCommonChip(false)} disabled={busy || !name.trim()} onClick={() => void mutate()}>{selected ? '変更' : '追加'}</button>
        <button type="button" className={procedureManualCommonChip(false)} disabled={busy || !selectedChoice || selectedChoice.inUse} onClick={() => setDeleting(true)}>削除</button>
        <button type="button" className={procedureManualCommonChip(true)} disabled={busy} onClick={() => changeEditing(false)}>完了</button>
      </div>
      {error ? <p role="alert" className="text-[#ff8a80]">{error}</p> : null}
    </> : children}
    <ConfirmDialog isOpen={deleting} title={`${title}を削除`} description={selectedChoice?.name} confirmLabel="削除" buttonClassName="min-h-12" onCancel={() => setDeleting(false)} onConfirm={() => { setDeleting(false); void mutate(true); }} />
  </section>;
}
