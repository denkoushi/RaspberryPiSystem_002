import { useRef, useState, type ReactNode } from 'react';

import { useInventoryMutations, useInventoryToolFieldOptions, useInventoryToolFieldValues } from '../../../../api/hooks';
import { CheckIcon, CloseIcon, EditIcon, GridIcon, PlusIcon, TrashIcon } from '../InventoryIcons';
import { invError, invEyebrow } from '../inventoryUi';

import { setupErrorText as errorText } from './setupError';

import type { InventoryOptionField } from '../../../../api/client';

export const TOOL_BOARD_COLUMNS: Array<{ key: InventoryOptionField; label: string }> = [
  { key: 'name', label: '名前' },
  { key: 'maker', label: 'メーカー' },
  { key: 'toolName', label: '工具名' },
  { key: 'workMaterial', label: '被削材' },
  { key: 'toolSize', label: '工具寸法' },
  { key: 'model', label: '型式' },
  { key: 'usage', label: '用途' },
];

/** The name an item gets when none was typed at registration; shown as 仮名 and never offered as a choice. */
export function isProvisionalInventoryName(name: string): boolean {
  return /^ItemlistRaspi \d+$/.test(name);
}

type Props = {
  accessPassword: string;
  /** Current value of each field of the item being edited. */
  current: Record<InventoryOptionField, string>;
  /** Sets one field of that item only. */
  onChange: (field: InventoryOptionField, value: string) => void;
  /** A value was renamed for every item that uses it. */
  onRenamed?: (field: InventoryOptionField, from: string, to: string) => void;
  /** What the name goes back to when it is taken out; without it the name cannot be emptied. */
  provisionalName?: string;
  /** Result of the last change, shown in its field lane. */
  status?: ReactNode;
  statusField?: InventoryOptionField;
  /** Given when the board floats over the screen; it then has a close button and narrower lanes. */
  onClose?: () => void;
  className?: string;
};

// Written out in full rather than layered on the shared button and field classes: Tailwind does not
// promise which of two same-property utilities wins, and these differ in size and colour.
const button = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40';
const quietButton = `${button} h-11 border-inv-line2 bg-transparent px-3 text-inv-muted hover:bg-inv-s2 hover:text-inv-text`;
const amberButton = `${button} h-11 border-inv-amber bg-inv-amber/[0.12] px-3 text-[#ffe8bf] hover:bg-inv-amber/20`;
const iconButton = `${button} h-11 border-transparent bg-transparent text-inv-muted hover:bg-inv-s2 hover:text-inv-text`;
const field = 'rounded-lg border bg-inv-bg text-inv-text placeholder:text-inv-faint focus:outline-none';

/**
 * Typed text is kept here and handed over when the field is left: by Enter, by the ✓ shown while the
 * text differs, or by going elsewhere. `onClear` gives the × shown while the text is the saved value.
 */
function Slot({ label, value, required, disabled, onCommit, onClear }: { label: string; value: string; required: boolean; disabled: boolean; onCommit: (next: string) => void; onClear?: () => void }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const commit = () => {
    // Read the field itself: with a Japanese IME the last conversion may not have reached state yet.
    const next = (input.current?.value ?? text).normalize('NFKC').trim();
    if (next === value) {
      setText(value);
      return;
    }
    if (!next && required) {
      setText(value);
      return;
    }
    onCommit(next);
  };
  const dirty = text.trim() !== value;
  return (
    <>
      <input
        ref={input}
        aria-label={`${label}の値`}
        placeholder="—"
        className={`${field} h-11 w-full border-inv-line2 pl-3 pr-12 text-[15px] font-bold focus:border-inv-cyan`}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          // Enter that only confirms an IME conversion must not leave the field.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) event.currentTarget.blur();
        }}
      />
      {dirty && !disabled ? (
        // Leaving the field is what saves; preventDefault keeps that the only path on browsers that do not focus buttons.
        <button type="button" tabIndex={-1} className={`${button} absolute right-0 top-0 h-11 w-11 border-inv-cyan bg-inv-cyan text-inv-cyan-ink`} aria-label={`${label}を確定`} onMouseDown={(event) => { event.preventDefault(); input.current?.blur(); }}><CheckIcon /></button>
      ) : null}
      {!dirty && !disabled && value && onClear ? (
        <button type="button" className={`${iconButton} absolute right-0 top-0 w-11`} aria-label={`${label}を空にする`} onClick={onClear}><CloseIcon /></button>
      ) : null}
    </>
  );
}

/**
 * One lane per field: the item's value on top and the registered values below it.
 * A tap or typed text changes this one item. まとめて直す switches to the registered values themselves:
 * renaming one changes every item that uses it, and values no item uses can be added or removed.
 */
export function ToolValueBoard({ accessPassword, current, onChange, onRenamed, provisionalName, status, statusField, onClose, className = '' }: Props) {
  const [organizing, setOrganizing] = useState(false);
  const options = useInventoryToolFieldOptions(!organizing);
  const values = useInventoryToolFieldValues(accessPassword, organizing, true);
  const mutations = useInventoryMutations(accessPassword, true);
  const [renaming, setRenaming] = useState<{ field: InventoryOptionField; from: string; to: string; count: number } | null>(null);
  const [deleting, setDeleting] = useState<{ field: InventoryOptionField; value: string } | null>(null);
  const [adding, setAdding] = useState<Partial<Record<InventoryOptionField, string>>>({});
  const [errorField, setErrorField] = useState<InventoryOptionField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = mutations.renameToolFieldValue.isPending || mutations.addToolFieldValue.isPending || mutations.deleteToolFieldValue.isPending;
  const dense = Boolean(onClose);

  const clear = (field: InventoryOptionField) => {
    if (field !== 'name') onChange(field, '');
    else if (provisionalName) onChange(field, provisionalName);
  };
  /** Typed text becomes this item's value and stays as a choice, so it can be picked next time. */
  const typed = async (field: InventoryOptionField, value: string) => {
    onChange(field, value);
    if (field === 'name' && isProvisionalInventoryName(value)) return;
    setError(null);
    setErrorField(field);
    try {
      await mutations.addToolFieldValue.mutateAsync({ field, value });
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const rename = async () => {
    if (!renaming) return;
    setError(null);
    setErrorField(renaming.field);
    try {
      const result = await mutations.renameToolFieldValue.mutateAsync({ field: renaming.field, from: renaming.from, to: renaming.to });
      onRenamed?.(renaming.field, renaming.from, result.value);
      setRenaming(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const remove = async (field: InventoryOptionField, value: string) => {
    setError(null);
    setErrorField(field);
    try {
      await mutations.deleteToolFieldValue.mutateAsync({ field, value });
      if (current[field] === value) clear(field);
      setDeleting(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const add = async (field: InventoryOptionField) => {
    const value = adding[field]?.trim();
    if (!value) return;
    setError(null);
    setErrorField(field);
    try {
      await mutations.addToolFieldValue.mutateAsync({ field, value });
      setAdding((entries) => ({ ...entries, [field]: '' }));
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const toggleOrganizing = () => {
    setOrganizing((on) => !on);
    setRenaming(null);
    setDeleting(null);
    setError(null);
  };

  const rowClass = `flex min-h-11 min-w-11 shrink-0 items-center gap-1.5 rounded-lg border py-[5px] text-left leading-snug ${dense ? 'pl-2 pr-1.5' : 'pl-2.5 pr-1.5'}`;
  const lanes = dense
    ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.85fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.9fr)]'
    : 'grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.7fr)_minmax(0,1fr)]';

  return (
    <section
      role={onClose ? 'dialog' : undefined}
      aria-label="名前・工具情報"
      className={`flex min-h-0 flex-col gap-3 rounded-[18px] border bg-inv-s1 px-[18px] pb-[18px] pt-3.5 text-inv-text ${organizing ? 'border-inv-amber/60' : dense ? 'border-inv-line2' : 'border-inv-line'} ${className}`}
    >
      <div className="flex h-11 shrink-0 items-center gap-3">
        <h3 className="text-[15px] font-black">名前・工具情報</h3>
        <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${organizing ? 'bg-inv-amber/[0.12] text-[#ffe8bf]' : 'bg-inv-cyan/[0.12] text-[#dff8ff]'}`}>
          {organizing ? <><GridIcon />使っている全アイテム</> : <><span className="h-1.5 w-1.5 rounded-sm bg-current" aria-hidden="true" />この1件</>}
        </span>

        <span className="flex-1" />
        <button type="button" aria-pressed={organizing} className={organizing ? amberButton : quietButton} onClick={toggleOrganizing}>
          <EditIcon size={14} />まとめて直す
        </button>
        {onClose ? <button type="button" className={`${iconButton} h-11 w-11`} aria-label="閉じる" onClick={onClose}><CloseIcon /></button> : null}
      </div>
      <div className={`grid min-h-0 flex-1 gap-2 ${lanes}`}>
        {TOOL_BOARD_COLUMNS.map((column) => {
          const value = current[column.key];
          const provisional = column.key === 'name' && isProvisionalInventoryName(value);
          const shown = provisional ? '' : value;
          const tone = organizing ? 'border-transparent' : provisional ? 'border-inv-amber/45' : shown ? 'border-inv-cyan/35' : 'border-transparent';
          return (
            <div key={column.key} role="group" aria-label={column.label} className={`flex min-h-0 min-w-0 flex-col gap-1.5 rounded-xl border bg-inv-s2/60 ${dense ? 'p-1.5' : 'p-2'} ${tone}`}>
              <div className="flex h-[18px] items-center gap-1.5 px-0.5">
                <span className={invEyebrow}>{column.label}</span>
                {provisional ? <span className="rounded-[5px] bg-inv-amber/[0.12] px-1.5 text-[10.5px] font-bold tracking-[0.08em] text-inv-amber">仮名</span> : null}
              </div>
              <div className={`relative shrink-0 ${organizing ? 'opacity-[0.34]' : ''}`}>
                <Slot
                  key={shown}
                  label={column.label}
                  value={shown}
                  required={column.key === 'name' && !provisionalName}
                  disabled={organizing}
                  onCommit={(next) => (next ? void typed(column.key, next) : clear(column.key))}
                  onClear={column.key !== 'name' || provisionalName ? () => clear(column.key) : undefined}
                />
              </div>
              <div className="flex h-12 shrink-0 items-center overflow-hidden text-sm leading-4">
                {error && errorField === column.key ? <p role="alert" className={`line-clamp-2 ${invError}`}>{error}</p> : statusField === column.key ? status : null}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto border-t border-dashed border-inv-line pt-1.5">
                {organizing ? (
                  <>
                    {(values.data?.[column.key] ?? []).map((entry) => {
                      if (renaming?.field === column.key && renaming.from === entry.value) {
                        return (
                          <div key={entry.value} className="flex shrink-0 flex-col gap-1.5 rounded-[10px] border border-inv-amber/45 bg-inv-amber/[0.12] p-2">
                            <input aria-label={`${entry.value}の新しい名前`} className={`${field} h-11 w-full border-inv-amber px-2.5 text-sm font-bold`} value={renaming.to} autoFocus onChange={(event) => setRenaming({ ...renaming, to: event.target.value })} />
                            {renaming.count > 0 ? <span className="text-xs text-[#ffe8bf]"><b className="tabular-nums">{renaming.count}</b>件が変わります</span> : null}
                            <span className="flex gap-1.5">
                              <button type="button" className={`${button} h-11 flex-1 border-inv-amber bg-inv-amber px-2 text-inv-amber-ink`} disabled={busy || !renaming.to.trim() || renaming.to.trim() === renaming.from} onClick={() => void rename()}><CheckIcon />変える</button>
                              <button type="button" className={`${iconButton} w-11`} aria-label="やめる" onClick={() => setRenaming(null)}><CloseIcon /></button>
                            </span>
                          </div>
                        );
                      }
                      if (deleting?.field === column.key && deleting.value === entry.value) {
                        return (
                          <div key={entry.value} className={`${rowClass} border-inv-red/45 bg-inv-bg text-sm`}>
                            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{entry.value}</span>
                            <button type="button" className={`${button} h-11 border-inv-red/60 bg-inv-s2 px-2 text-[#ffb3b3]`} disabled={busy} onClick={() => void remove(column.key, entry.value)}>削除</button>
                            <button type="button" className={`${iconButton} w-11`} aria-label="やめる" onClick={() => setDeleting(null)}><CloseIcon /></button>
                          </div>
                        );
                      }
                      const row = (grow: boolean) => (
                        <button
                          key={entry.value}
                          type="button"
                          aria-label={`${entry.value}の名前を変える`}
                          className={`${rowClass} border-inv-line bg-inv-bg hover:border-inv-amber/45 hover:bg-inv-s2 ${grow ? 'min-w-0 flex-1' : ''} ${dense ? 'text-[13px]' : 'text-sm'}`}
                          onClick={() => { setDeleting(null); setRenaming({ field: column.key, from: entry.value, to: entry.value, count: entry.count }); }}
                        >
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{entry.value}</span>
                          <span className="text-right text-[11.5px] tabular-nums text-inv-faint">{entry.count || ''}</span>
                          {dense ? null : <span className="text-inv-faint"><EditIcon size={13} /></span>}
                        </button>
                      );
                      if (entry.count > 0) return row(false);
                      return (
                        <div key={entry.value} className="flex shrink-0 gap-1">
                          {row(true)}
                          <button type="button" className={`${button} h-11 border-transparent bg-transparent text-[#ffb3b3] hover:bg-inv-red/10 w-11`} aria-label={`${entry.value}を削除`} onClick={() => { setRenaming(null); setDeleting({ field: column.key, value: entry.value }); }}><TrashIcon /></button>
                        </div>
                      );
                    })}
                    <div className="flex shrink-0 gap-1">
                      <input aria-label={`${column.label}に追加する値`} placeholder="新しい値" className={`${field} h-11 min-w-0 flex-1 border-inv-line2 px-2.5 text-[13px] focus:border-inv-cyan`} value={adding[column.key] ?? ''} onChange={(event) => setAdding((entries) => ({ ...entries, [column.key]: event.target.value }))} />
                      <button type="button" className={`${button} h-11 w-11 border-inv-line2 bg-inv-s2 text-inv-text hover:bg-inv-s3`} aria-label={`${column.label}に追加`} disabled={busy || !adding[column.key]?.trim()} onClick={() => void add(column.key)}><PlusIcon /></button>
                    </div>
                  </>
                ) : (
                  <>
                    {(options.data?.[column.key] ?? []).length === 0 ? <span className="px-0.5 py-2 text-[13px] text-inv-faint">まだありません</span> : null}
                    {(options.data?.[column.key] ?? []).map((option) => {
                      const on = shown === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={on}
                          className={`${rowClass} text-sm ${on ? 'border-inv-cyan bg-inv-cyan/[0.12] font-bold text-[#dff8ff] shadow-[inset_0_0_0_1px_#39d0f0]' : 'border-inv-line bg-inv-bg hover:border-inv-line2 hover:bg-inv-s2'}`}
                          onClick={() => (on ? clear(column.key) : onChange(column.key, option))}
                        >
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{option}</span>
                          {on && !dense ? <span className="text-inv-cyan"><CheckIcon /></span> : null}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
