import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useRef, useState } from 'react';

import { dismissAssemblyCheckSheetGmailImport, getAssemblyCheckSheetGmailImport, listAssemblyCheckSheetGmailImports, importAssemblyCheckSheet, listAssemblyCheckSheetRevisions, saveAssemblyCheckSheetRevision } from '../../../api/domains/assembly/check-sheets';
import { getKioskEmployees } from '../../../api/domains/kiosk';
import { getApiErrorMessage } from '../../../api/errors';
import { kioskQueryKeys } from '../../../api/queryKeys/kiosk';
import { Button } from '../../../components/ui/Button';

import { CheckSheetItemPanel, CheckSheetToggle, inputKinds, labelClass } from './CheckSheetItemPanel';
import { buildSavePayload, departmentRoleKeys, removeItem } from './editor';

import type { AssemblyCheckSheetImportPayload, AssemblyCheckSheetProposal } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const gmailImportsQueryKey = ['assembly-check-sheet-gmail-imports'];
const revisionQueryKey = ['assembly-check-sheet-revisions'];
const headerCells = [
  ['date', '日付'], ['shipDate', '出荷予定日'], ['productNo', '製品No'],
  ['seiban', '製番'], ['productName', '製品名'], ['customer', '客先名']
] as const;
function shortDate(value: string) {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function errorMessage(error: unknown) {
  const message = getApiErrorMessage(error, '処理に失敗しました');
  const issues: unknown = isAxiosError(error) ? error.response?.data?.issues : undefined;
  if (!Array.isArray(issues)) return message;
  return [message, ...issues.flatMap((issue: { path?: unknown; message?: unknown }) =>
    typeof issue?.message === 'string'
      ? [`${Array.isArray(issue.path) ? issue.path.join('.') : ''}: ${issue.message}`] : []
  )].join('\n');
}

export function CheckSheetLibraryPage({ backLink }: { backLink?: ReactNode }) {
  const queryClient = useQueryClient();
  const revisions = useQuery({ queryKey: revisionQueryKey, queryFn: listAssemblyCheckSheetRevisions });
  const gmailImports = useQuery({ queryKey: gmailImportsQueryKey, queryFn: listAssemblyCheckSheetGmailImports });
  const employees = useQuery({ queryKey: kioskQueryKeys.employees(), queryFn: () => getKioskEmployees() });
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<AssemblyCheckSheetImportPayload | null>(null);
  const [saveMode, setSaveMode] = useState<'new' | 'revision'>('new');
  const [rootId, setRootId] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<'item' | 'cells' | 'members'>('item');
  const openDraft = (result: AssemblyCheckSheetImportPayload, name: string) => {
    setDraft(result);
    setRoles(departmentRoleKeys(result.proposal));
    setFileName(name);
    setSelected(Math.max(0, result.proposal.items.findIndex((item) => item.warnings.length)));
    setTab('item');
    const matching = revisions.data?.find((revision) => result.proposal.documentNo.trim() && revision.documentNo === result.proposal.documentNo);
    setSaveMode(matching ? 'revision' : 'new');
    setRootId(matching?.revisionRootId ?? '');
    save.reset();
  };
  const upload = useMutation({ mutationFn: importAssemblyCheckSheet, onSuccess: (result, file) => openDraft(result, file.name) });
  const openGmailImport = useMutation({
    mutationFn: (importId: string) => getAssemblyCheckSheetGmailImport(importId), onSuccess: (result, importId) => openDraft(result, gmailImports.data?.items.find((item) => item.importId === importId)?.originalFileName ?? '')
  });
  const dismissGmailImport = useMutation({
    mutationFn: dismissAssemblyCheckSheetGmailImport,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: gmailImportsQueryKey }); }
  });
  const save = useMutation({
    mutationFn: saveAssemblyCheckSheetRevision,
    onSuccess: (saved) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof listAssemblyCheckSheetRevisions>>>(revisionQueryKey, (current = []) =>
        [saved, ...current.filter((revision) => revision.revisionRootId !== saved.revisionRootId)]);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: gmailImportsQueryKey });
      void queryClient.invalidateQueries({ queryKey: revisionQueryKey });
    }
  });
  const edit = (change: (proposal: AssemblyCheckSheetProposal) => AssemblyCheckSheetProposal) => {
    setDraft((current) => current ? { ...current, proposal: change(current.proposal) } : current);
    save.reset();
  };
  const proposal = draft?.proposal;
  const selectedItem = proposal?.items[selected];
  const warnings = proposal?.items.flatMap((item, index) => item.warnings.length ? [index] : []) ?? [];
  const inbox = gmailImports.data?.items ?? [];
  const busy = revisions.isLoading || upload.isPending || openGmailImport.isPending || dismissGmailImport.isPending;
  const selectItem = (index: number) => { setSelected(index); setTab('item'); };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-900 text-[22px] text-slate-100 [font-variant-numeric:tabular-nums] [&_input]:h-14 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-lg [&_input]:border-2 [&_input]:border-slate-600 [&_input]:bg-slate-900 [&_input]:px-3 [&_input]:text-[22px] [&_input]:text-white [&_select]:h-14 [&_select]:min-w-0 [&_select]:rounded-lg [&_select]:border-2 [&_select]:border-slate-600 [&_select]:bg-slate-900 [&_select]:px-3 [&_select]:text-xl [&_select]:text-white [&_textarea]:min-w-0 [&_textarea]:resize-none [&_textarea]:rounded-lg [&_textarea]:border-2 [&_textarea]:border-slate-600 [&_textarea]:bg-slate-900 [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-[22px] [&_textarea]:text-white [&_button]:min-h-[52px] [&_:focus-visible]:outline [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-emerald-500">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-700 bg-slate-800 px-4">
        {draft ? <Button type="button" variant="ghostOnDark" disabled={save.isPending} className="h-9 px-3 text-base" onClick={() => { setDraft(null); upload.reset(); openGmailImport.reset(); }}>やめる</Button> : backLink}
        <h1 className="min-w-0 truncate text-lg font-bold">{draft ? fileName || '取り込み内容' : '組立チェックシート'}</h1>
        {!draft && <div className="ml-auto shrink-0">
          <input ref={fileInput} type="file" accept=".xlsx" aria-label="チェックシートファイル" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) upload.mutate(file);
          }} />
          <Button variant="ghostOnDark" disabled={busy} onClick={() => fileInput.current?.click()} className="h-9 px-3 text-base">ファイルから取り込み</Button>
        </div>}
      </header>
      {!draft ? <>
        {upload.isError && <p role="alert" className="whitespace-pre-wrap px-8 text-red-300">{errorMessage(upload.error)}</p>}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,820fr)_minmax(0,1100fr)]">
          <section className="grid min-h-0 min-w-0 grid-rows-[40px_minmax(0,1fr)]">
            <div className="flex items-center gap-2 px-4"><h2 className="text-lg font-bold">届いたシート</h2><span className={`rounded-full px-2 text-base font-bold ${inbox.length ? 'bg-emerald-500 text-white' : 'bg-slate-800'}`}>{inbox.length}</span></div>
            <div className="min-h-0 space-y-3 overflow-y-auto px-4 pb-4">
              {(gmailImports.isError || openGmailImport.isError || dismissGmailImport.isError) && <p role="alert" className="whitespace-pre-wrap text-red-300">{errorMessage(gmailImports.error ?? openGmailImport.error ?? dismissGmailImport.error)}</p>}
              {gmailImports.isLoading ? <p role="status">読み込み中</p> : !gmailImports.isError && !inbox.length && <div className="grid h-[220px] place-items-center rounded-2xl border-2 border-dashed border-slate-700 text-2xl text-slate-400">届いたシートはありません</div>}
              {inbox.map((item) => <div key={item.importId} className="grid grid-cols-[minmax(0,1fr)_150px] overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-800">
                <button type="button" disabled={busy} className="grid gap-2 px-6 py-5 text-left hover:bg-slate-700 disabled:opacity-60" onClick={() => openGmailImport.mutate(item.importId)}>
                  <span className="break-words text-[26px] font-bold">{item.originalFileName || '取り込み内容'}</span><span className="text-xl text-slate-400">{item.receivedAt && shortDate(item.receivedAt)}</span>
                </button>
                <button type="button" disabled={busy} className="border-l-2 border-slate-700 text-slate-400 hover:bg-slate-700 disabled:opacity-60" onClick={() => dismissGmailImport.mutate(item.importId)}>対象外</button>
              </div>)}
            </div>
          </section>
          <section className="grid min-h-0 min-w-0 grid-rows-[40px_minmax(0,1fr)] border-l-2 border-slate-700">
            <div className="flex items-center gap-2 px-4"><h2 className="text-lg font-bold">保存済み</h2><span className="rounded-full bg-slate-800 px-2 text-base font-bold">{revisions.data?.length ?? 0}</span></div>
            <div className="min-h-0 overflow-auto px-4 pb-4">
              {revisions.isError && <p role="alert" className="text-red-300">{errorMessage(revisions.error)}</p>}
              {revisions.isLoading && <p role="status">読み込み中</p>}
              <table className="w-full table-fixed text-left [&_td]:break-words [&_td]:border-b [&_td]:border-slate-700 [&_td]:px-4 [&_td]:py-[18px] [&_th]:sticky [&_th]:top-0 [&_th]:border-b-2 [&_th]:border-slate-700 [&_th]:bg-slate-900 [&_th]:px-4 [&_th]:pb-3 [&_th]:text-[19px] [&_th]:font-semibold [&_th]:text-slate-400">
                <colgroup><col className="w-1/4" /><col /><col className="w-[150px]" /><col className="w-[100px]" /><col className="w-[170px]" /></colgroup>
                <thead><tr>{['文書番号', '名称', '機種', '版', '保存日'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{(revisions.data ?? []).map((revision) => <tr key={revision.id} className="hover:bg-slate-800">
                  <td className="font-mono text-xl">{revision.documentNo}</td><td>{revision.title}</td><td className="font-mono text-xl">{revision.modelCode}</td>
                  <td>{revision.revisionNumber}{revision.revisionLabel ? ` / ${revision.revisionLabel}` : ''}</td><td>{shortDate(revision.createdAt)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      </> : proposal && <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate(buildSavePayload(draft.importId, proposal, saveMode === 'revision' ? rootId : undefined));
      }}>
        <fieldset disabled={save.isPending} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <section className="shrink-0 border-b-2 border-slate-700">
            <div className="grid h-[104px] grid-cols-[300px_minmax(0,1fr)_220px_140px_auto] items-end gap-4 px-8 py-3">
              {([['documentNo', '文書番号'], ['title', '名称'], ['modelCode', '機種'], ['revisionLabel', '版']] as const).map(([key, label]) => <label key={key} className={labelClass}>{label}
                <input required={key === 'title'} value={proposal[key]} onChange={(event) => edit((current) => ({ ...current, [key]: event.target.value }))} />
              </label>)}
              <div className="flex items-end gap-3">
                <div className="flex gap-1" role="group" aria-label="保存方法">{(['new', 'revision'] as const).map((mode) => <CheckSheetToggle key={mode} pressed={saveMode === mode} onClick={() => { setSaveMode(mode); save.reset(); }}>{mode === 'new' ? '新規' : '改訂'}</CheckSheetToggle>)}</div>
                {saveMode === 'revision' && <select aria-label="改訂元シート" required className="w-[330px]" value={rootId} onChange={(event) => { setRootId(event.target.value); save.reset(); }}>
                  <option value="">改訂元シート</option>{(revisions.data ?? []).map((revision) => <option key={revision.revisionRootId} value={revision.revisionRootId}>{revision.documentNo} 版{revision.revisionNumber}</option>)}
                </select>}
                <Button type="submit" className="h-16 px-7 text-[22px]" disabled={save.isPending || !proposal.items.length || (saveMode === 'revision' && !rootId)}>保存</Button>
              </div>
            </div>
            {save.isError && <p role="alert" className="whitespace-pre-wrap px-8 pb-3 text-red-300">{errorMessage(save.error)}</p>}
          </section>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_700px]">
            <section className="grid min-h-0 min-w-0 grid-rows-[60px_minmax(0,1fr)]">
              <div className="flex items-center gap-3.5 px-8"><span>{proposal.items.length} 項目</span>{warnings.length > 0 && <><span className="rounded-lg bg-amber-950 px-3 py-1 text-lg font-bold text-amber-300">要確認 {warnings.length}</span><Button type="button" variant="ghostOnDark" className="text-xl" onClick={() => {
                const next = warnings.find((index) => index > selected) ?? warnings[0];
                selectItem(next);
                document.getElementById(`check-sheet-row-${next}`)?.scrollIntoView?.({ block: 'nearest' });
              }}>次の要確認へ</Button></>}</div>
              <div className="min-h-0 overflow-y-auto px-8 pb-2">
                {proposal.groups.map((group) => <div key={group.groupNo}>
                  {proposal.items.some((item) => item.groupNo === group.groupNo) && <h3 className="mb-0.5 mt-1.5 text-[19px] font-semibold text-slate-400">{group.groupNo} {group.label}</h3>}
                  {proposal.items.map((item, index) => item.groupNo === group.groupNo && <button key={index} id={`check-sheet-row-${index}`} type="button" data-testid="check-sheet-item" aria-current={selected === index} onClick={() => selectItem(index)}
                    className={`grid w-full grid-cols-[84px_minmax(0,1fr)_150px_170px] items-center gap-4 rounded-xl border-2 px-[18px] py-1.5 text-left ${selected === index ? 'border-emerald-500 bg-slate-700' : 'border-transparent hover:bg-slate-800'} ${item.warnings.length ? '!bg-amber-950' : ''}`}>
                    <span className="font-mono text-slate-400">{item.itemKey}</span><span className="break-words font-semibold">{item.label}{item.warnings.map((warning, i) => <span key={i} className="ml-4 text-lg text-amber-300">{warning}</span>)}</span>
                    <span className="justify-self-start rounded-lg bg-slate-700 px-3 py-1 text-lg font-bold">{inputKinds[item.inputKind]}</span><span className="text-[19px] text-slate-400">{item.roleKeys.join('・')}</span>
                  </button>)}
                </div>)}
              </div>
            </section>
            <aside className="grid min-h-0 min-w-0 grid-rows-[56px_minmax(0,1fr)] border-l-2 border-slate-700 bg-slate-800">
              <div className="flex items-center gap-1.5 border-b-2 border-slate-700 px-6">
                <div role="tablist" aria-label="見直し" className="flex h-full min-w-0">
                  {([['item', `項目 ${selectedItem?.itemKey ?? ''}`], ['cells', '記入セル'], ['members', '担当者']] as const).map(([key, label]) => <button key={key} type="button" role="tab" id={`check-sheet-tab-${key}`} aria-selected={tab === key} aria-controls="check-sheet-pane" className={`h-16 border-b-4 px-4 font-bold ${tab === key ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400'}`} onClick={() => setTab(key)}>{label}</button>)}
                </div>
                {tab === 'item' && selectedItem && <button type="button" className="ml-auto whitespace-nowrap text-xl text-slate-400 underline underline-offset-4" aria-label={`${selectedItem.itemKey} 対象外にする`} onClick={() => {
                  edit((current) => removeItem(current, selected));
                  setSelected(Math.max(0, Math.min(selected, proposal.items.length - 2)));
                }}>対象外にする</button>}
              </div>
              <div role="tabpanel" id="check-sheet-pane" aria-labelledby={`check-sheet-tab-${tab}`} className="grid min-h-0 content-start gap-3.5 overflow-y-auto px-7 pb-6 pt-[18px]">
                {tab === 'item' && <CheckSheetItemPanel proposal={proposal} index={selected} edit={edit} roles={roles} />}
                {tab === 'cells' && <div className="grid grid-cols-3 gap-3.5">{headerCells.map(([key, label]) => <label key={key} className={labelClass}>{label}<input value={proposal.headerCellMap[key] ?? ''} onChange={(event) => edit((current) => ({ ...current, headerCellMap: { ...current.headerCellMap, [key]: event.target.value } }))} /></label>)}</div>}
                {tab === 'members' && <>
                  {employees.isLoading && <p role="status">社員を読み込み中</p>}
                  {employees.isError && <p role="alert" className="text-red-300">{errorMessage(employees.error)}</p>}
                  {roles.map((role) => <div key={role} className="grid gap-2.5"><h4 className="text-xl font-semibold">{role}</h4><div role="group" aria-label={role} className="flex flex-wrap gap-2.5">
                    {(employees.data ?? []).map((employee) => {
                      const ids = proposal.departmentRoleMembers[role] ?? [];
                      return <CheckSheetToggle key={employee.id} pressed={ids.includes(employee.id)} onClick={() => edit((current) => ({ ...current, departmentRoleMembers: { ...current.departmentRoleMembers, [role]: ids.includes(employee.id) ? ids.filter((id) => id !== employee.id) : [...ids, employee.id] } }))}>{employee.displayName}</CheckSheetToggle>;
                    })}
                  </div></div>)}
                </>}
              </div>
            </aside>
          </div>
        </fieldset>
      </form>}
    </div>
  );
}
