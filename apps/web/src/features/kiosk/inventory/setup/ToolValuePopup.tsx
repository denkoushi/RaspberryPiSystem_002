import { useState } from 'react';

import { useInventoryMutations, useInventoryToolFieldOptions, useInventoryToolFieldValues } from '../../../../api/hooks';
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, TrashIcon } from '../InventoryIcons';
import { invButtonSm, invButtonSmGhost, invError, invEyebrow, invField, invIconButton } from '../inventoryUi';

import type { InventoryOptionField } from '../../../../api/client';

export const TOOL_OPTION_COLUMNS: Array<{ key: InventoryOptionField; label: string }> = [
  { key: 'maker', label: 'メーカー' },
  { key: 'toolName', label: '工具名' },
  { key: 'workMaterial', label: '被削材' },
  { key: 'toolSize', label: '工具寸法' },
  { key: 'model', label: '型式' },
  { key: 'usage', label: '用途' },
];

type Props = {
  accessPassword: string;
  /** Current value of each field in the form, to mark and toggle the chosen one. */
  current: Record<InventoryOptionField, string>;
  onChange: (field: InventoryOptionField, value: string) => void;
  onClose: () => void;
};

function errorText(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : '処理に失敗しました';
}

/** 型式 values are long, so that column is wider; other columns fit a word or two. */
function columnWidth(field: InventoryOptionField, editing: boolean): string {
  if (field === 'model') return editing ? 'w-[410px]' : 'w-[320px]';
  return editing ? 'w-[210px]' : 'w-[180px]';
}

/**
 * Registered values per field. 選ぶ puts a value in the form and a second tap takes it out again;
 * 編集 renames (items using the value follow), adds, or removes values no item uses.
 */
export function ToolValuePopup({ accessPassword, current, onChange, onClose }: Props) {
  const [editing, setEditing] = useState(false);
  const options = useInventoryToolFieldOptions(!editing);
  const values = useInventoryToolFieldValues(accessPassword, editing);
  const mutations = useInventoryMutations(accessPassword);
  const [renaming, setRenaming] = useState<{ field: InventoryOptionField; from: string; to: string; count: number } | null>(null);
  const [deleting, setDeleting] = useState<{ field: InventoryOptionField; value: string } | null>(null);
  const [adding, setAdding] = useState<Partial<Record<InventoryOptionField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const busy = mutations.renameToolFieldValue.isPending || mutations.addToolFieldValue.isPending || mutations.deleteToolFieldValue.isPending;

  const rename = async () => {
    if (!renaming) return;
    setError(null);
    try {
      const result = await mutations.renameToolFieldValue.mutateAsync({ field: renaming.field, from: renaming.from, to: renaming.to });
      // The form follows the rename so the worker does not register the old spelling.
      if (current[renaming.field] === renaming.from) onChange(renaming.field, result.value);
      setRenaming(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const remove = async (field: InventoryOptionField, value: string) => {
    setError(null);
    try {
      await mutations.deleteToolFieldValue.mutateAsync({ field, value });
      if (current[field] === value) onChange(field, '');
      setDeleting(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const add = async (field: InventoryOptionField) => {
    const value = adding[field]?.trim();
    if (!value) return;
    setError(null);
    try {
      await mutations.addToolFieldValue.mutateAsync({ field, value });
      setAdding((entries) => ({ ...entries, [field]: '' }));
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const segment = (on: boolean) => `flex h-[34px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-bold ${on ? 'bg-inv-s3 text-inv-text' : 'text-inv-muted hover:text-inv-text'}`;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#05080d]/60" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-label={editing ? '登録済みの値を編集' : '登録済みの値から選ぶ'}
        className={`fixed left-1/2 top-28 z-50 flex max-h-[calc(100dvh-9rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-4 rounded-[20px] border border-inv-line2 bg-inv-s1 px-[22px] pb-[22px] pt-5 text-inv-text shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(57,208,240,0.25)] ${editing ? 'w-[1590px]' : 'w-[1350px]'}`}
      >
        <div className="flex items-center gap-3">
          <strong className="text-[17px] font-black">{editing ? '登録済みの値を編集' : '登録済みから選ぶ'}</strong>
          <span className="text-[13px] text-inv-faint">{editing ? '数字＝使っているアイテム数' : 'もう一度押すと外れます'}</span>
          <span className="flex-1" />
          <div className="flex rounded-[10px] border border-inv-line bg-inv-bg p-[3px]" role="group" aria-label="モード">
            <button type="button" aria-pressed={!editing} className={segment(!editing)} onClick={() => { setEditing(false); setRenaming(null); setDeleting(null); setError(null); }}>選ぶ</button>
            <button type="button" aria-pressed={editing} className={segment(editing)} onClick={() => setEditing(true)}><EditIcon size={13} />編集</button>
          </div>
          <button type="button" className={invIconButton} aria-label="閉じる" onClick={onClose}><CloseIcon /></button>
        </div>
        {error ? <p className={`rounded-lg border px-3 py-2 text-sm ${invError}`} role="alert">{error}</p> : null}
        <div className="flex min-h-0 items-start gap-4 overflow-auto">
          {TOOL_OPTION_COLUMNS.map((column) => (
            <div key={column.key} className={`flex shrink-0 flex-col gap-1.5 ${columnWidth(column.key, editing)}`} role="group" aria-label={column.label}>
              <span className={`${invEyebrow} h-[18px] px-0.5`}>{column.label}</span>
              {editing ? (
                <>
                  {(values.data?.[column.key] ?? []).map((entry) => {
                    if (renaming?.field === column.key && renaming.from === entry.value) {
                      return (
                        <div key={entry.value} className="flex flex-col gap-1.5 rounded-[10px] border border-inv-cyan/40 bg-inv-cyan/[0.12] p-2">
                          <input aria-label={`${entry.value}の新しい名前`} className={`${invField} h-9 border-inv-cyan`} value={renaming.to} autoFocus onChange={(event) => setRenaming({ ...renaming, to: event.target.value })} />
                          {renaming.count > 0 ? <span className="text-xs text-[#dff8ff]">アイテム <b className="tabular-nums">{renaming.count}</b>件も変わります</span> : null}
                          <span className="flex gap-1.5">
                            <button type="button" className={`${invButtonSm} flex-1 border-inv-cyan bg-inv-cyan text-inv-cyan-ink hover:bg-inv-cyan`} disabled={busy || !renaming.to.trim() || renaming.to.trim() === renaming.from} onClick={() => void rename()}><CheckIcon />変える</button>
                            <button type="button" className={invButtonSmGhost} onClick={() => setRenaming(null)}>やめる</button>
                          </span>
                        </div>
                      );
                    }
                    const confirming = deleting?.field === column.key && deleting.value === entry.value;
                    return (
                      <div key={entry.value} className="flex min-h-10 items-center gap-1 rounded-lg border border-inv-line bg-inv-bg py-1 pl-2.5 pr-1 text-sm leading-snug">
                        <span className="min-w-0 flex-1 break-all">{entry.value}</span>
                        {confirming ? (
                          <>
                            <button type="button" className={`${invButtonSm} border-inv-red/60 text-[#ffb3b3]`} disabled={busy} onClick={() => void remove(column.key, entry.value)}>消す</button>
                            <button type="button" className={invIconButton} aria-label="やめる" onClick={() => setDeleting(null)}><CloseIcon /></button>
                          </>
                        ) : (
                          <>
                            <span className="min-w-[18px] text-right text-[11px] tabular-nums text-inv-faint">{entry.count || ''}</span>
                            <button type="button" className={invIconButton} aria-label={`${entry.value}の名前を変える`} onClick={() => { setDeleting(null); setRenaming({ field: column.key, from: entry.value, to: entry.value, count: entry.count }); }}><EditIcon /></button>
                            {entry.count === 0
                              ? <button type="button" className={`${invIconButton} text-[#ffb3b3]`} aria-label={`${entry.value}を削除`} onClick={() => { setRenaming(null); setDeleting({ field: column.key, value: entry.value }); }}><TrashIcon /></button>
                              : <span className="w-9 shrink-0" />}
                          </>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex gap-1">
                    <input aria-label={`${column.label}に追加する値`} placeholder="新しい値" className={`${invField} h-9 min-w-0 flex-1 text-[13px]`} value={adding[column.key] ?? ''} onChange={(event) => setAdding((entries) => ({ ...entries, [column.key]: event.target.value }))} />
                    <button type="button" className={`${invButtonSm} w-9 px-0`} aria-label={`${column.label}に追加`} disabled={busy || !adding[column.key]?.trim()} onClick={() => void add(column.key)}><PlusIcon /></button>
                  </div>
                </>
              ) : (
                <>
                  {(options.data?.[column.key] ?? []).length === 0 ? <span className="px-0.5 py-2.5 text-[13px] text-inv-faint">まだありません</span> : null}
                  {(options.data?.[column.key] ?? []).map((value) => {
                    const on = current[column.key] === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={on}
                        className={`flex min-h-10 items-center gap-2 break-all rounded-lg px-2.5 py-[7px] text-left text-sm leading-snug ${on ? 'border-2 border-inv-cyan bg-inv-cyan/[0.12] font-bold' : 'border border-inv-line bg-inv-bg hover:border-inv-line2 hover:bg-inv-s2'}`}
                        onClick={() => onChange(column.key, on ? '' : value)}
                      >
                        {on ? <span className="text-inv-cyan"><CheckIcon /></span> : null}
                        <span className="flex-1">{value}</span>
                        {on ? <span className="text-inv-cyan"><CloseIcon /></span> : null}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
