import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createProcedureManualCommon } from '../../../api/client';
import { Dialog } from '../../../components/ui/Dialog';
import { kioskAssemblyManualsWorkshopPath, kioskAssemblyProcedureDocumentEditPath } from '../assemblyRoutes';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureManualButtonBase, procedureManualButtonUnselected, procedureManualCommonChip, procedureManualCommonInput } from './procedure-manual-button-styles';
import { ProcedureManualCommonChoiceEditor } from './ProcedureManualCommonChoiceEditor';
import { ProcedureManualKanaRowPicker, resolveProcedureManualCommonReading } from './ProcedureManualKanaRowPicker';

import type { ProcedureManualAssignmentOverviewItemDto, ProcedureManualCommonCatalogDto } from '../types';

export function ProcedureManualCommonDialog({ catalog, items, categoryId, onClose, onChanged, onFix, beforeMutation }: {
  catalog: ProcedureManualCommonCatalogDto; items: ProcedureManualAssignmentOverviewItemDto[]; categoryId: string;
  onClose: () => void; onChanged: () => Promise<void>; onFix: (item: ProcedureManualAssignmentOverviewItemDto) => void; beforeMutation: () => boolean;
}) {
  const navigate = useNavigate();
  const [target, setTarget] = useState('');
  const [actionId, setActionId] = useState('');
  const [reading, setReading] = useState('');
  const [editingAction, setEditingAction] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = creating || actionBusy;
  const resolved = resolveProcedureManualCommonReading(target, catalog);
  const key = resolved.key;
  const kanaRow = resolved.kanaRow ?? reading;
  const action = catalog.actions.find(row => row.id === actionId);
  const duplicate = items.find(row => row.processId === categoryId && row.modelCodeKey === key && row.label === action?.name);
  const similar = key ? items.filter(row => row.modelCodeKey.includes(key) || key.includes(row.modelCodeKey)) : categoryId ? items.filter(row => row.processId === categoryId) : [];
  const create = async () => {
    if (busy || editingAction || duplicate || !categoryId || !key || !action || !kanaRow || !beforeMutation()) return;
    setCreating(true); setError(null);
    try {
      const document = await createProcedureManualCommon({ categoryId, target: target.trim(), actionId, kanaRow });
      navigate(kioskAssemblyProcedureDocumentEditPath(document.id), { state: {
        returnTo: kioskAssemblyManualsWorkshopPath({ common: '1', process: categoryId }),
        context: { modelCode: document.modelCode, modelCodeKey: document.modelCodeKey, processId: categoryId,
          processName: `共通 › ${catalog.categories.find(row => row.id === categoryId)?.name ?? ''}`, mode: 'make' }
      } });
    } catch (e) { setError(readAssemblyApiErrorMessage(e, '作成できません')); }
    finally { setCreating(false); }
  };
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} title="共通の手順を作る" size="full" className="!my-auto !max-w-[1180px] !rounded-xl !border !border-[#344252] !bg-[#161c22] !px-7 !py-6 !text-[#eef3f6]" titleClassName="!text-[26px] !font-bold text-[#eef3f6]">
    <form className="mt-4 grid gap-4" onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className="grid grid-cols-[minmax(0,1fr)_430px] gap-7">
        <div className="grid content-start gap-3.5">
          <h3 className="text-base font-semibold tracking-wider text-[#9fadb9]">対象</h3>
          <input aria-label="対象" placeholder="工具・設備の名前" maxLength={179} value={target} className={procedureManualCommonInput} onChange={event => { setTarget(event.target.value); setReading(''); }} />
          <div className="flex max-h-[112px] flex-wrap gap-2 overflow-auto">{catalog.subjects.filter(row => !categoryId || row.categoryIds.includes(categoryId)).map(row => <button key={row.key} type="button" aria-pressed={key === row.key} className={procedureManualCommonChip(key === row.key)} onClick={() => { setTarget(row.name); setReading(''); }}>{row.name}</button>)}</div>
          {resolved.needsReading ? <ProcedureManualKanaRowPicker value={reading} onChange={setReading} /> : null}
          <ProcedureManualCommonChoiceEditor kind="actions" choices={catalog.actions} beforeMutation={beforeMutation} onChanged={onChanged}
            onDeleted={id => setActionId(current => current === id ? '' : current)} onEditingChange={setEditingAction} onBusyChange={setActionBusy} disabled={busy}>
            <div className="flex max-h-[160px] flex-wrap gap-2 overflow-auto">{catalog.actions.map(row => (
              <button key={row.id} type="button" disabled={busy} aria-pressed={actionId === row.id} className={procedureManualCommonChip(actionId === row.id)} onClick={() => setActionId(row.id)}>{row.name}</button>
            ))}</div>
          </ProcedureManualCommonChoiceEditor>
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
        <button type="submit" className={`${procedureManualButtonBase} h-14 border-[#3ba776] bg-[#3ba776] px-[26px] text-xl font-extrabold text-[#0b1a12] disabled:opacity-[.35]`} disabled={busy || editingAction || !!duplicate || !categoryId || !key || !action || !kanaRow}>作ってエディタへ</button>
      </footer>
    </form>
  </Dialog>;
}
