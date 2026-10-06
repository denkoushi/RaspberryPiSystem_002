import { toHalfWidthAscii } from '@raspi-system/shared-types';
import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';

import {
  getAssemblyProcedureDocumentRevisions, getKioskDocuments, getProcedureManualAssignments,
  listAssemblyProcedureDocumentSummaries, replaceProcedureManualAssignments
} from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import type { ProcedureManualAssignmentInput, ProcedureManualProcessDto } from '../types';

export const procedureManualModelKey = (value: string) => toHalfWidthAscii(value.trim()).toUpperCase().trim();

type Choice = { key: string; title: string; kioskDocumentId?: string; assemblyProcedureDocumentId?: string };
type Props = {
  beforeMutation?: () => boolean;
  modelCode: string;
  processId: string;
  processes: ProcedureManualProcessDto[];
  onClose: () => void;
  onSaved: (modelCodeKey: string, processId: string) => void;
};

export function ProcedureManualAssignmentDialog({ modelCode: initialModel, processId: initialProcess, processes, onClose, onSaved, beforeMutation }: Props) {
  const [modelCode, setModelCode] = useState(initialModel);
  const [processId, setProcessId] = useState(initialProcess || processes.find((p) => p.parentId)?.id || '');
  const [items, setItems] = useState<ProcedureManualAssignmentInput[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [choiceKey, setChoiceKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modelCodeKey = procedureManualModelKey(modelCode);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listAssemblyProcedureDocumentSummaries({ limit: 200 }),
      getKioskDocuments({ hideDisabled: true, fields: 'summary', limit: 200 })
    ]).then(async ([documents, pdfs]) => {
      // The existing summaries list contains revision heads. A draft head may
      // still have an older published revision that can be assigned.
      const publishedDocuments = await Promise.all(documents.map(async (document) => {
        if (document.status === 'published') return document;
        if (!document.revisionRootId) return null;
        // One failing history lookup must not hide every other candidate.
        const history = await getAssemblyProcedureDocumentRevisions(document.id).catch(() => []);
        return history.filter((revision) => revision.isActive && revision.status === 'published')
          .sort((a, b) => (b.revisionNumber ?? 1) - (a.revisionNumber ?? 1))[0] ?? null;
      }));
      if (cancelled) return;
      setChoices([
        ...publishedDocuments.flatMap((d) => d && d.isActive ? [{
          key: `assembly:${d.revisionRootId ?? d.id}`, title: d.name, assemblyProcedureDocumentId: d.revisionRootId ?? d.id
        }] : []),
        ...pdfs.filter((d) => d.enabled).map((d) => ({ key: `pdf:${d.id}`, title: d.displayTitle || d.title, kioskDocumentId: d.id }))
      ]);
    }).catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '文書を取得できません')); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setError(null);
    setLoadFailed(false);
    if (!modelCodeKey || !processId) { setLoading(false); return; }
    setLoading(true);
    void getProcedureManualAssignments(modelCodeKey, processId).then((detail) => {
      if (!cancelled) setItems(detail.assignments.map((item) => ({
        kioskDocumentId: item.kioskDocumentId, assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
        sortOrder: item.sortOrder, label: item.label
      })));
    }).catch((e: unknown) => { if (!cancelled) { setLoadFailed(true); setError(readAssemblyApiErrorMessage(e, '割り当てを取得できません')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [modelCodeKey, processId]);

  const save = async () => {
    if (beforeMutation && !beforeMutation()) return;
    setBusy(true);
    setError(null);
    try {
      await replaceProcedureManualAssignments(modelCodeKey, processId, {
        modelCode, assignments: items.map((item, sortOrder) => ({ ...item, sortOrder }))
      });
      onSaved(modelCodeKey, processId);
    } catch (e: unknown) {
      setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '保存できません'));
    } finally { setBusy(false); }
  };
  const move = (index: number, offset: number) => {
    setItems((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  };
  const canEdit = !loading && !loadFailed && !busy && Boolean(modelCodeKey && processId);
  return (
    <Dialog isOpen onClose={busy ? () => undefined : onClose} title="割り当てを編集" size="lg" className="!bg-[#161c22] !text-[#eef3f6]">
      <div className="mt-3 grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="型番" placeholder="型番" value={modelCode} disabled={busy} onChange={(e) => setModelCode(e.target.value)} />
          <select aria-label="工程" className="min-h-11 rounded-md border border-white/20 bg-[#1f2730] px-2" value={processId} disabled={busy} onChange={(e) => setProcessId(e.target.value)}>
            {processes.filter((p) => p.parentId).map((p) => <option key={p.id} value={p.id}>{processes.find((parent) => parent.id === p.parentId)?.name} &gt; {p.name}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <select aria-label="文書" className="min-h-11 min-w-0 flex-1 rounded-md border border-white/20 bg-[#1f2730] px-2" value={choiceKey} disabled={busy} onChange={(e) => setChoiceKey(e.target.value)}>
            <option value="">文書を選択</option>
            {choices.map((choice) => <option key={choice.key} value={choice.key}>{choice.title}{choice.kioskDocumentId ? '（PDF）' : ''}</option>)}
          </select>
          <Button disabled={!canEdit || !choiceKey} className="min-h-11" onClick={() => {
            const choice = choices.find((c) => c.key === choiceKey);
            if (choice) setItems([...items, { kioskDocumentId: choice.kioskDocumentId ?? null, assemblyProcedureDocumentId: choice.assemblyProcedureDocumentId ?? null, sortOrder: items.length, label: null }]);
          }}>追加</Button>
        </div>
        <ol className="max-h-72 space-y-2 overflow-auto" aria-label="文書の並び">
          {items.map((item, index) => <li key={index} className="flex flex-wrap items-center gap-2 rounded border border-white/15 p-2">
            <span className="min-w-0 flex-1 truncate text-sm">{choices.find((c) => item.kioskDocumentId ? c.kioskDocumentId === item.kioskDocumentId : c.assemblyProcedureDocumentId === item.assemblyProcedureDocumentId)?.title || item.label || item.assemblyProcedureDocumentId || item.kioskDocumentId}</span>
            <Input aria-label={`表示名 ${index + 1}`} placeholder="表示名(任意)" className="!w-36" value={item.label ?? ''} disabled={!canEdit} onChange={(e) => setItems(items.map((row, i) => i === index ? { ...row, label: e.target.value || null } : row))} />
            <Button variant="ghostOnDark" aria-label={`上へ ${index + 1}`} disabled={!canEdit || index === 0} onClick={() => move(index, -1)}>↑</Button>
            <Button variant="ghostOnDark" aria-label={`下へ ${index + 1}`} disabled={!canEdit || index === items.length - 1} onClick={() => move(index, 1)}>↓</Button>
            <Button variant="ghostOnDark" aria-label={`外す(紐づけ解除) ${index + 1}`} disabled={!canEdit} onClick={() => setItems(items.filter((_, i) => i !== index))}>外す(紐づけ解除)</Button>
          </li>)}
        </ol>
        {loading ? <p role="status">読込中…</p> : items.length === 0 ? <p className="text-sm text-[#9fadb9]">まだ割り当てがありません。型番を入れて文書を追加してください</p> : null}
        {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghostOnDark" disabled={busy} onClick={onClose}>閉じる</Button>
          <Button className="min-h-11" disabled={!canEdit} onClick={() => void save()}>保存</Button>
        </div>
      </div>
    </Dialog>
  );
}
