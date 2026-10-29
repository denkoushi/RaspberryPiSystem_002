import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useRef, useState } from 'react';

import { importAssemblyCheckSheet, listAssemblyCheckSheetRevisions, saveAssemblyCheckSheetRevision } from '../../../api/domains/assembly/check-sheets';
import { getKioskEmployees } from '../../../api/domains/kiosk';
import { getApiErrorMessage } from '../../../api/errors';
import { kioskQueryKeys } from '../../../api/queryKeys/kiosk';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';

import { addField, buildSavePayload, departmentRoleKeys, removeField, removeItem, updateField, updateItem } from './editor';

import type { AssemblyCheckSheetImportPayload, AssemblyCheckSheetItemProposal, AssemblyCheckSheetProposal } from '@raspi-system/shared-types';

const revisionQueryKey = ['assembly-check-sheet-revisions'];
const selectClass = 'w-full rounded-md border-2 border-slate-500 bg-slate-900 px-3 py-3 text-white';
const headerCells = [
  ['date', '日付'], ['shipDate', '出荷予定日'], ['productNo', '製品No'],
  ['seiban', '製番'], ['productName', '製品名'], ['customer', '客先名']
] as const;
const inputKinds = { OK_NG: 'OK / NG', NUMBER: '数値', TEXT: '文字', CHOICE: '選択', NONE: '入力なし' } as const;

function errorMessage(error: unknown) {
  const message = getApiErrorMessage(error, '処理に失敗しました');
  const issues: unknown = isAxiosError(error) ? error.response?.data?.issues : undefined;
  if (!Array.isArray(issues)) return message;
  return [message, ...issues.flatMap((issue: { path?: unknown; message?: unknown }) =>
    typeof issue?.message === 'string'
      ? [`${Array.isArray(issue.path) ? issue.path.join('.') : ''}: ${issue.message}`] : []
  )].join('\n');
}

export function CheckSheetLibraryPage() {
  const queryClient = useQueryClient();
  const revisions = useQuery({ queryKey: revisionQueryKey, queryFn: listAssemblyCheckSheetRevisions });
  const employees = useQuery({ queryKey: kioskQueryKeys.employees(), queryFn: () => getKioskEmployees() });
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<AssemblyCheckSheetImportPayload | null>(null);
  const [saveMode, setSaveMode] = useState<'new' | 'revision'>('new');
  const [rootId, setRootId] = useState('');
  const upload = useMutation({
    mutationFn: importAssemblyCheckSheet,
    onSuccess: (result) => {
      setDraft(result);
      setSaveMode('new');
      setRootId('');
      save.reset();
    }
  });
  const save = useMutation({
    mutationFn: saveAssemblyCheckSheetRevision,
    onSuccess: (saved) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof listAssemblyCheckSheetRevisions>>>(revisionQueryKey, (current = []) =>
        [saved, ...current.filter((revision) => revision.revisionRootId !== saved.revisionRootId)]);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: revisionQueryKey });
    }
  });
  const edit = (change: (proposal: AssemblyCheckSheetProposal) => AssemblyCheckSheetProposal) => {
    setDraft((current) => current ? { ...current, proposal: change(current.proposal) } : current);
    save.reset();
  };
  const proposal = draft?.proposal;
  const changeItem = (index: number, patch: Partial<AssemblyCheckSheetItemProposal>) => edit((current) => updateItem(current, index, patch));

  return (
    <div className="min-w-0 space-y-4 text-white [&_input]:min-h-12 [&_input]:min-w-0 [&_input]:bg-slate-900 [&_input]:text-white [&_button]:min-h-12">
      <h1 className="text-2xl font-bold">組立チェックシート</h1>
      {!draft ? (
        <Card className="min-w-0 !bg-slate-800 !text-white" title="版一覧" action={
          <>
            <input ref={fileInput} type="file" accept=".xlsx" aria-label="チェックシートファイル" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) upload.mutate(file);
            }} />
            <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()}>取り込み</Button>
          </>
        }>
          {upload.isError && <p role="alert" className="mb-3 whitespace-pre-wrap text-red-300">{errorMessage(upload.error)}</p>}
          {revisions.isError && <p role="alert" className="mb-3 text-red-300">{errorMessage(revisions.error)}</p>}
          {revisions.isLoading && <p role="status">読み込み中</p>}
          <div className="min-w-0">
            <table className="w-full table-fixed text-left text-base [&_td]:break-words">
              <thead className="border-b-2 border-slate-300"><tr>{['文書番号', '名称', '機種', '版', '保存日'].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
              <tbody>{(revisions.data ?? []).map((revision) => (
                <tr key={revision.id} className="border-b border-slate-200">
                  <td className="p-2">{revision.documentNo}</td><td className="p-2">{revision.title}</td><td className="p-2">{revision.modelCode}</td>
                  <td className="p-2">{revision.revisionNumber}{revision.revisionLabel ? ` / ${revision.revisionLabel}` : ''}</td>
                  <td className="p-2">{new Date(revision.createdAt).toLocaleString('ja-JP')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      ) : proposal && (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending) save.mutate(buildSavePayload(draft.importId, proposal, saveMode === 'revision' ? rootId : undefined));
        }}>
          <fieldset disabled={save.isPending} className="min-w-0 space-y-4">
            <Card className="min-w-0 !bg-slate-800 !text-white" title="取り込み内容">
              <div className="grid gap-3 md:grid-cols-4">
                {([['documentNo', '文書番号'], ['title', '名称'], ['modelCode', '機種'], ['revisionLabel', '版']] as const).map(([key, label]) => (
                  <label key={key} className="grid gap-1 text-sm font-semibold">{label}
                    <Input required={key === 'title'} value={proposal[key]} onChange={(event) => edit((current) => ({ ...current, [key]: event.target.value }))} />
                  </label>
                ))}
              </div>
            </Card>
            <Card className="min-w-0 !bg-slate-800 !text-white" title="ヘッダーセル対応">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                {headerCells.map(([key, label]) => (
                  <label key={key} className="grid gap-1 text-sm font-semibold">{label}
                    <Input value={proposal.headerCellMap[key] ?? ''} onChange={(event) => edit((current) => ({
                      ...current, headerCellMap: { ...current.headerCellMap, [key]: event.target.value }
                    }))} />
                  </label>
                ))}
              </div>
            </Card>
            <Card className="min-w-0 !bg-slate-800 !text-white" title="部署役割">
              {employees.isLoading && <p role="status">社員を読み込み中</p>}
              {employees.isError && <p role="alert" className="text-red-300">{errorMessage(employees.error)}</p>}
              <div className="grid gap-3 md:grid-cols-3">
                {departmentRoleKeys(proposal).map((role) => (
                  <label key={role} className="grid gap-1 text-sm font-semibold">{role}
                    <select multiple className={selectClass} value={proposal.departmentRoleMembers[role] ?? []} disabled={!employees.data} onChange={(event) => {
                      const ids = Array.from(event.target.selectedOptions, (option) => option.value);
                      edit((current) => ({ ...current, departmentRoleMembers: { ...current.departmentRoleMembers, [role]: ids } }));
                    }}>
                      {(employees.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </Card>
            <Card className="min-w-0 !bg-slate-800 !text-white" title="項目">
              <div className="space-y-4">{proposal.items.map((item, index) => (
                <div key={index} data-testid="check-sheet-item" className={`grid min-w-0 grid-cols-1 gap-4 rounded-lg border border-slate-500 p-4 md:grid-cols-3 xl:grid-cols-4 ${item.warnings.length ? 'bg-amber-950' : 'bg-slate-900'}`}>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">大項目</div>
                    <select aria-label={`${item.itemKey} 大項目`} className={selectClass} value={item.groupNo} onChange={(event) => changeItem(index, { groupNo: Number(event.target.value) })}>
                      {proposal.groups.map((group) => <option key={group.groupNo} value={group.groupNo}>{group.groupNo} {group.label}</option>)}
                    </select>
                    <Input aria-label={`${item.itemKey} 大項目名`} value={proposal.groups.find((group) => group.groupNo === item.groupNo)?.label ?? ''} onChange={(event) => edit((current) => ({
                      ...current, groups: current.groups.map((group) => group.groupNo === item.groupNo ? { ...group, label: event.target.value } : group)
                    }))} />
                  </div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">項目番号</div><Input aria-label={`${item.itemKey} 項目番号`} value={item.itemKey} onChange={(event) => changeItem(index, { itemKey: event.target.value })} /></div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">文言</div>
                    <textarea aria-label={`${item.itemKey} 文言`} rows={3} className={selectClass} value={item.label} onChange={(event) => changeItem(index, { label: event.target.value })} />
                    {item.warnings.map((warning, i) => <p key={i} className="mt-1 text-xs font-semibold text-amber-200">{warning}</p>)}
                  </div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">入力の種類</div><select aria-label={`${item.itemKey} 入力の種類`} className={selectClass} value={item.inputKind} onChange={(event) => changeItem(index, { inputKind: event.target.value as AssemblyCheckSheetItemProposal['inputKind'] })}>
                    {Object.entries(inputKinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                  </select></div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">入力欄</div>
                    {(item.inputSpec.fields?.length ?? 0) > 0 && <div className="grid grid-cols-[minmax(0,1fr)_6rem_3rem] gap-1 font-semibold"><span>ラベル</span><span>単位</span></div>}
                    {(item.inputSpec.fields ?? []).map((field) => (
                      <div key={field.key} className="flex items-center gap-1">
                        <Input aria-label={`${item.itemKey} ${field.key} ラベル`} value={field.label} onChange={(event) => edit((current) => updateField(current, index, field.key, { label: event.target.value }))} />
                        <Input aria-label={`${item.itemKey} ${field.key} 単位`} className="max-w-24" value={field.unit ?? ''} onChange={(event) => edit((current) => updateField(current, index, field.key, { unit: event.target.value }))} />
                        <Button type="button" variant="ghostOnDark" aria-label={`${item.itemKey} ${field.key} 入力欄を削除`} onClick={() => edit((current) => removeField(current, index, field.key))}>×</Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghostOnDark" aria-label={`${item.itemKey} 入力欄を追加`} onClick={() => edit((current) => addField(current, index))}>追加</Button>
                  </div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">選択肢</div>{item.inputKind === 'CHOICE' && <textarea aria-label={`${item.itemKey} 選択肢`} rows={3} className={selectClass} value={(item.inputSpec.options ?? []).join('\n')} onChange={(event) => changeItem(index, { inputSpec: { ...item.inputSpec, options: event.target.value.split('\n') } })} />}</div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">役割</div><textarea aria-label={`${item.itemKey} 役割`} rows={3} className={selectClass} value={item.roleKeys.join('\n')} onChange={(event) => changeItem(index, { roleKeys: event.target.value.split('\n') })} /></div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">条件キー / 条件文</div>
                    <Input aria-label={`${item.itemKey} 条件キー`} value={item.conditionKey ?? ''} onChange={(event) => changeItem(index, { conditionKey: event.target.value || null })} />
                    <textarea aria-label={`${item.itemKey} 条件文`} rows={3} className={selectClass} value={item.conditionLabel ?? ''} onChange={(event) => changeItem(index, { conditionLabel: event.target.value || null })} />
                  </div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">押印セル</div><Input aria-label={`${item.itemKey} 押印セル`} value={item.stampCell} onChange={(event) => changeItem(index, { stampCell: event.target.value.toUpperCase() })} /></div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">値の書き込み先</div>
                    <select aria-label={`${item.itemKey} 書き込み方式`} className={selectClass} value={item.valueTarget.mode} onChange={(event) => changeItem(index, { valueTarget: event.target.value === 'cell'
                      ? { mode: 'cell', cell: item.valueTarget.cell }
                      : { mode: 'inline', cell: item.valueTarget.cell, template: item.label } })}>
                      <option value="cell">セル</option><option value="inline">文中</option>
                    </select>
                    <Input aria-label={`${item.itemKey} 値セル`} value={item.valueTarget.cell} onChange={(event) => changeItem(index, { valueTarget: { ...item.valueTarget, cell: event.target.value.toUpperCase() } })} />
                    {item.valueTarget.mode === 'inline' && <textarea aria-label={`${item.itemKey} テンプレート`} rows={3} className={selectClass} value={item.valueTarget.template} onChange={(event) => changeItem(index, { valueTarget: { mode: 'inline', cell: item.valueTarget.cell, template: event.target.value } })} />}
                  </div>
                  <div className="min-w-0 space-y-2"><div className="font-semibold">操作</div><Button type="button" variant="ghostOnDark" className="whitespace-nowrap" aria-label={`${item.itemKey} 対象外にする`} onClick={() => edit((current) => removeItem(current, index))}>対象外にする</Button></div>
                </div>
              ))}</div>
            </Card>
            <Card className="min-w-0 !bg-slate-800 !text-white" title="保存">
              <div className="flex flex-wrap items-center gap-3">
                <select aria-label="保存方法" className={`${selectClass} max-w-xs`} value={saveMode} onChange={(event) => { setSaveMode(event.target.value as 'new' | 'revision'); save.reset(); }}>
                  <option value="new">新規シートとして保存</option><option value="revision">既存シートの改訂として保存</option>
                </select>
                {saveMode === 'revision' && <select aria-label="改訂元シート" required className={`${selectClass} max-w-sm`} value={rootId} onChange={(event) => { setRootId(event.target.value); save.reset(); }}>
                  <option value="">改訂元シート</option>
                  {(revisions.data ?? []).map((revision) => <option key={revision.revisionRootId} value={revision.revisionRootId}>{revision.documentNo} {revision.title} / {revision.revisionNumber}</option>)}
                </select>}
                <Button type="submit" disabled={save.isPending || !proposal.items.length || (saveMode === 'revision' && !rootId)}>保存</Button>
                <Button type="button" variant="ghostOnDark" onClick={() => { setDraft(null); upload.reset(); }}>キャンセル</Button>
              </div>
              {save.isError && <p role="alert" className="mt-3 whitespace-pre-wrap text-red-300">{errorMessage(save.error)}</p>}
            </Card>
          </fieldset>
        </form>
      )}
    </div>
  );
}
