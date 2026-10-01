/**
 * グラフ系ボード（可視化ダッシュボード）の設定を、JSON を書かずに入力するためのモデル（純関数）。
 * 保存形式は従来どおり dataSourceConfig / rendererConfig の JSON 文字列で、
 * ここでは「決まったキーだけを読み書きし、ほかのキーには触れない」。
 */

export type GraphTemplate = 'uninspected' | 'measuring' | 'rigging' | 'pallet' | 'custom';

export interface GraphField {
  key: string;
  target: 'dataSource' | 'renderer';
  label: string;
  kind: 'number' | 'text' | 'date';
  placeholder: string;
  min?: number;
  max?: number;
}

const TEMPLATE_BY_DATA_SOURCE: Record<string, Exclude<GraphTemplate, 'custom'>> = {
  uninspected_machines: 'uninspected',
  measuring_instrument_loan_inspection: 'measuring',
  rigging_loan_inspection: 'rigging',
  pallet_visualization_board: 'pallet',
};

export const GRAPH_TEMPLATE_LABEL: Record<GraphTemplate, string> = {
  uninspected: '未点検加工機',
  measuring: '計測機器 点検状況',
  rigging: '吊具 点検状況',
  pallet: 'パレット現在状態',
  custom: 'ひな形なし',
};

export function detectGraphTemplate(dataSourceType: string): GraphTemplate {
  return TEMPLATE_BY_DATA_SOURCE[dataSourceType.trim()] ?? 'custom';
}

const LOAN_INSPECTION_FIELDS: GraphField[] = [
  { key: 'sectionEquals', target: 'dataSource', label: '対象の部署', kind: 'text', placeholder: '加工担当部署' },
  { key: 'maxRows', target: 'renderer', label: '1画面の表示人数', kind: 'number', placeholder: '24', min: 1, max: 200 },
];

const FIELDS: Record<GraphTemplate, GraphField[]> = {
  uninspected: [
    { key: 'maxRows', target: 'renderer', label: '1画面の表示台数', kind: 'number', placeholder: '18', min: 1, max: 200 },
    { key: 'maxRows', target: 'dataSource', label: '読み込む行数の上限', kind: 'number', placeholder: '30', min: 1, max: 1000 },
    { key: 'date', target: 'dataSource', label: '日付（空欄＝当日）', kind: 'date', placeholder: '当日' },
  ],
  measuring: LOAN_INSPECTION_FIELDS,
  rigging: LOAN_INSPECTION_FIELDS,
  pallet: [
    { key: 'machinesPerPage', target: 'renderer', label: '1ページの台数', kind: 'number', placeholder: '6', min: 1, max: 24 },
    { key: 'pageIndex', target: 'renderer', label: '表示するページ（0 が最初）', kind: 'number', placeholder: '0', min: 0, max: 99 },
  ],
  custom: [],
};

export function graphFieldsFor(template: GraphTemplate): GraphField[] {
  return FIELDS[template];
}

function parseObject(jsonText: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(jsonText.trim() === '' ? '{}' : jsonText);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** JSON として読めるか（読めないときは入力欄を止めて「詳しい設定」で直してもらう） */
export function isEditableJson(jsonText: string): boolean {
  return parseObject(jsonText) !== null;
}

export function readJsonField(jsonText: string, key: string): string {
  const value = parseObject(jsonText)?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * 1 つのキーだけを書き換えた JSON 文字列を返す。ほかのキーと並び順は保つ。
 * 空欄はキーごと消す（空文字は API の入力チェックに通らない項目があるため残さない）。JSON が壊れているときは変更しない。
 */
export function writeJsonField(jsonText: string, field: Pick<GraphField, 'key' | 'kind' | 'min' | 'max'>, rawValue: string): string {
  const current = parseObject(jsonText);
  if (!current) return jsonText;
  const next: Record<string, unknown> = { ...current };
  const trimmed = rawValue.trim();
  if (trimmed === '') {
    delete next[field.key];
  } else if (field.kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return jsonText;
    next[field.key] = trimmed;
  } else if (field.kind === 'number') {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return jsonText;
    const lower = field.min ?? Number.NEGATIVE_INFINITY;
    const upper = field.max ?? Number.POSITIVE_INFINITY;
    next[field.key] = Math.min(upper, Math.max(lower, Math.trunc(parsed)));
  } else {
    next[field.key] = rawValue;
  }
  return JSON.stringify(next, null, 2);
}
