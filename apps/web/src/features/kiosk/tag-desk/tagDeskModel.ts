import type { TagBindingKind, TagDeskKind, TagDeskOptions } from '../../../api/domains/tag-desk';

export const TAG_DESK_KINDS: TagDeskKind[] = ['employee', 'item', 'instrument', 'rigging'];

export type KindMeta = {
  label: string;
  codeLabel: string;
  subLabel: string;
  sub2Label?: string;
  /** What the tag is used for; shown before releasing it. */
  uses: string[];
};

export const KIND_META: Record<TagBindingKind, KindMeta> = {
  employee: { label: '社員', codeLabel: '社員コード', subLabel: '部門', sub2Label: '部署', uses: ['持出・返却', '組立 作業者', '組立 承認', '自主検査 測定者', 'ナレッジ投稿'] },
  item: { label: '工具', codeLabel: '管理番号', subLabel: '保管場所', uses: ['持出・返却'] },
  instrument: { label: '計測機器', codeLabel: '管理番号', subLabel: '保管場所', uses: ['持出・返却', '自主検査 使用機器', '使用前点検'] },
  rigging: { label: '吊具', codeLabel: '管理番号', subLabel: '保管場所', uses: ['持出・返却', '点検記録'] },
  inventory: { label: '在庫タグ', codeLabel: '種類', subLabel: '場所', uses: ['在庫の出庫・補充'] }
};

const ASSET_STATUS: Record<string, string> = { AVAILABLE: '利用可', IN_USE: '使用中', MAINTENANCE: '整備中', RETIRED: '廃棄' };
const EMPLOYEE_STATUS: Record<string, string> = { ACTIVE: '在籍', INACTIVE: '無効', SUSPENDED: '停止' };

export function statusLabel(kind: TagBindingKind, status: string | null): string {
  if (!status) return '';
  return (kind === 'employee' ? EMPLOYEE_STATUS : ASSET_STATUS)[status] ?? status;
}

/** Statuses worth a warning chip in lists. */
export function statusTone(status: string | null): 'warn' | null {
  return status && ['IN_USE', 'MAINTENANCE', 'RETIRED', 'INACTIVE', 'SUSPENDED'].includes(status) ? 'warn' : null;
}

/** UIDs are hex byte pairs; show them separated so two tags can be told apart at a glance. */
export function uidBytes(uid: string): string[] {
  const clean = uid.replace(/[:\s-]/g, '');
  if (clean.length >= 8 && clean.length % 2 === 0 && /^[0-9a-f]+$/i.test(clean)) {
    return clean.toUpperCase().match(/.{2}/g) ?? [uid];
  }
  return [uid];
}

/** Short form for list cells: the bytes that differ between tags (the first byte is the maker). */
export function shortUid(uid: string): string {
  const bytes = uidBytes(uid);
  return bytes.length > 1 ? bytes.slice(1, 5).join(':') : uid.slice(0, 12);
}

export type FieldSpec = {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'select';
  required?: boolean;
  /** Width in characters-ish; controls are sized to their content. */
  width: 'xs' | 's' | 'm' | 'l';
  placeholder?: string;
  options?: (opts: TagDeskOptions, values: Record<string, string>) => Array<{ value: string; label: string }>;
};

const assetStatusOptions = () => Object.entries(ASSET_STATUS).map(([value, label]) => ({ value, label }));
const departmentOptions = (opts: TagDeskOptions) => [{ value: '', label: '未設定' }, ...opts.departments.map((d) => ({ value: d, label: d }))];
const sectionOptions = (opts: TagDeskOptions, values: Record<string, string>) => [
  { value: '', label: '未設定' },
  ...opts.sections.filter((section) => values.department && section.division === values.department).map((section) => ({ value: section.name, label: section.name }))
];

export function changeRecordField(kind: TagDeskKind, opts: TagDeskOptions, values: Record<string, string>, key: string, value: string): Record<string, string> {
  const next = { ...values, [key]: value };
  if (kind === 'employee' && key === 'department' && value !== values.department
    && !sectionOptions(opts, next).some((option) => option.value === next.section)) {
    next.section = '';
  }
  return next;
}

export const FORM_FIELDS: Record<TagDeskKind, FieldSpec[]> = {
  employee: [
    { key: 'employeeCode', label: '社員コード', type: 'text', required: true, width: 'xs', placeholder: '0001' },
    { key: 'lastName', label: '苗字', type: 'text', required: true, width: 's' },
    { key: 'firstName', label: '名前', type: 'text', required: true, width: 's' },
    { key: 'department', label: '部門', type: 'select', width: 'm', options: (opts) => [{ value: '', label: '未設定' }, ...opts.divisions.map((division) => ({ value: division, label: division }))] },
    { key: 'section', label: '部署', type: 'select', width: 'm', options: sectionOptions },
    { key: 'positionName', label: '職位', type: 'select', width: 's', options: (opts) => [{ value: '', label: '未設定' }, ...opts.positions.map((position) => ({ value: position.name, label: position.name }))] },
    { key: 'status', label: '状態', type: 'select', width: 's', options: () => Object.entries(EMPLOYEE_STATUS).map(([value, label]) => ({ value, label })) }
  ],
  item: [
    { key: 'itemCode', label: '管理番号', type: 'text', required: true, width: 's', placeholder: 'TO0001' },
    { key: 'name', label: '名称', type: 'text', required: true, width: 'l' },
    { key: 'category', label: 'カテゴリ', type: 'text', width: 'm' },
    { key: 'storageLocation', label: '保管場所', type: 'text', width: 'm' },
    { key: 'status', label: '状態', type: 'select', width: 's', options: assetStatusOptions },
    { key: 'notes', label: '備考', type: 'text', width: 'l' }
  ],
  instrument: [
    { key: 'managementNumber', label: '管理番号', type: 'text', required: true, width: 's' },
    { key: 'name', label: '名称', type: 'text', required: true, width: 'l' },
    { key: 'genreId', label: 'ジャンル', type: 'select', width: 'm', options: (opts) => [{ value: '', label: '未設定' }, ...opts.genres.map((g) => ({ value: g.id, label: g.name }))] },
    { key: 'department', label: '部署', type: 'select', width: 'm', options: departmentOptions },
    { key: 'storageLocation', label: '保管場所', type: 'text', width: 'm' },
    { key: 'measurementRange', label: '測定範囲', type: 'text', width: 's', placeholder: '0〜25mm' },
    { key: 'calibrationExpiryDate', label: '校正期限', type: 'date', width: 's' },
    { key: 'status', label: '状態', type: 'select', width: 's', options: assetStatusOptions }
  ],
  rigging: [
    { key: 'managementNumber', label: '管理番号', type: 'text', required: true, width: 's' },
    { key: 'name', label: '名称', type: 'text', required: true, width: 'l' },
    { key: 'idNum', label: '旧番号', type: 'text', width: 's' },
    { key: 'department', label: '部署', type: 'select', width: 'm', options: departmentOptions },
    { key: 'storageLocation', label: '保管場所', type: 'text', width: 'm' },
    { key: 'maxLoadTon', label: '荷重(t)', type: 'number', width: 'xs' },
    { key: 'lengthMm', label: '長さ(mm)', type: 'number', width: 'xs' },
    { key: 'widthMm', label: '幅(mm)', type: 'number', width: 'xs' },
    { key: 'thicknessMm', label: '厚み(mm)', type: 'number', width: 'xs' },
    { key: 'startedAt', label: '使用開始', type: 'date', width: 's' },
    { key: 'status', label: '状態', type: 'select', width: 's', options: assetStatusOptions },
    { key: 'notes', label: '備考', type: 'text', width: 'l' }
  ]
};

export function emptyRecord(kind: TagDeskKind): Record<string, string> {
  const record: Record<string, string> = {};
  for (const field of FORM_FIELDS[kind]) record[field.key] = '';
  record.status = kind === 'employee' ? 'ACTIVE' : 'AVAILABLE';
  return record;
}

/** Form strings → API payload: blanks become null, numbers and dates are converted. */
export function toPayload(kind: TagDeskKind, values: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of FORM_FIELDS[kind]) {
    const raw = (values[field.key] ?? '').trim();
    if (field.type === 'number') payload[field.key] = raw === '' ? null : Number(raw);
    else if (field.type === 'date') payload[field.key] = raw === '' ? null : raw;
    else if (field.required || field.key === 'status') payload[field.key] = raw;
    else payload[field.key] = raw === '' ? null : raw;
  }
  return payload;
}
