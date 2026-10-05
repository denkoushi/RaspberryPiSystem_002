import { useState, type FormEvent } from 'react';


import { FORM_FIELDS, KIND_META, changeRecordField, emptyRecord, toPayload, type FieldSpec } from './tagDeskModel';
import { tagDesk } from './tagDeskTheme';

import type { TagDeskKind, TagDeskOptions } from '../../../api/domains/tag-desk';

const WIDTH: Record<FieldSpec['width'], string> = { xs: 'w-28', s: 'w-44', m: 'w-64', l: 'w-full' };

type Props = {
  kind: TagDeskKind;
  /** Existing record fields, or null for a new one. */
  record: Record<string, string | number> | null;
  name: string | null;
  options: TagDeskOptions;
  saving: boolean;
  deleting: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: () => void;
  onCancel: () => void;
};

export function TagDeskRecordForm({ kind, record, name, options, saving, deleting, onSave, onDelete, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const base = emptyRecord(kind);
    if (!record) return base;
    for (const key of Object.keys(base)) base[key] = record[key] == null ? '' : String(record[key]);
    return base;
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const label = KIND_META[kind].label;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(toPayload(kind, values));
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col gap-5" aria-label={record ? `${label}を編集` : `${label}を追加`}>
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-bold text-white">{record ? `${name ?? label} を編集` : `${label}を追加`}</h2>
      </div>
      <div className="flex min-h-0 flex-wrap content-start gap-x-4 gap-y-3 overflow-y-auto pr-1">
        {FORM_FIELDS[kind].map((field) => {
          const id = `tag-desk-${kind}-${field.key}`;
          const common = {
            id,
            value: values[field.key] ?? '',
            required: field.required,
            onChange: (event: { target: { value: string } }) => setValues((prev) => changeRecordField(kind, options, prev, field.key, event.target.value))
          };
          const selectOptions = field.options?.(options, values) ?? [];
          if (common.value && !selectOptions.some((option) => option.value === common.value)) {
            selectOptions.push({ value: common.value, label: common.value });
          }
          return (
            <label key={field.key} htmlFor={id} className={`flex flex-col gap-1 ${field.width === 'l' ? 'w-full' : ''}`}>
              <span className="text-[13px] font-bold text-[#8494a8]">
                {field.label}
                {field.required ? <span className="ml-1 text-[#ff5d5d]">*</span> : null}
              </span>
              {field.type === 'select' ? (
                <select {...common} className={`${tagDesk.input} ${WIDTH[field.width]}`}>
                  {selectOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  {...common}
                  type={field.type}
                  step={field.type === 'number' ? 'any' : undefined}
                  placeholder={field.placeholder}
                  className={`${tagDesk.input} ${WIDTH[field.width]} ${field.type === 'date' ? '[color-scheme:dark]' : ''}`}
                />
              )}
            </label>
          );
        })}
      </div>
      {confirmDelete ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#6b2a2d] bg-[#3a1719] px-4 py-3.5">
          <div className="min-w-0 flex-1 text-lg font-bold text-white">
            {name} を削除しますか？
            <small className="mt-0.5 block text-[13px] font-medium text-[#f0a3a3]">元に戻せません。持出の履歴は残ります</small>
          </div>
          <button type="button" className={`${tagDesk.btn} ${tagDesk.cutSolid}`} disabled={deleting} onClick={onDelete}>
            {deleting ? '削除しています…' : '削除'}
          </button>
          <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost}`} disabled={deleting} onClick={() => setConfirmDelete(false)}>やめる</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="submit" className={`${tagDesk.btn} ${tagDesk.go}`} disabled={saving}>{saving ? '保存しています…' : record ? '保存' : '登録'}</button>
          <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost}`} disabled={saving} onClick={onCancel}>やめる</button>
          {record ? (
            <button type="button" className={`${tagDesk.btn} ${tagDesk.cut} ml-auto`} onClick={() => setConfirmDelete(true)}>削除</button>
          ) : null}
        </div>
      )}
    </form>
  );
}
