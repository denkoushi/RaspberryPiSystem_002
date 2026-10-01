import { parseResourceCdListInput } from '../signage/signageScheduleDisplay';

import { parseTimeToMinutes } from './weekTimelineModel';

import type { BuiltinDataKind } from './hubModel';
import type { SignageFullSlotKind, SignageSplitSlotKind } from '../signage/signageLayoutConfigModel';

/** 「表示するもの」の選択肢 1 件。値は `<種類>:<ID>` の形で select の value に使う */
export type ContentChoice =
  | { type: 'builtin'; kind: BuiltinDataKind }
  | { type: 'web_page' | 'pdf' | 'csv_dashboard' | 'visualization'; id: string };

export function encodeContentChoice(choice: ContentChoice): string {
  return choice.type === 'builtin' ? `builtin:${choice.kind}` : `${choice.type}:${choice.id}`;
}

const BUILTIN_KINDS: BuiltinDataKind[] = [
  'loans',
  'kiosk_progress_overview',
  'kiosk_leader_order_cards',
  'mobile_placement_parts_shelf_grid',
  'self_inspection_machine_board',
];

export function decodeContentChoice(value: string): ContentChoice | null {
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const type = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  if (rest === '') return null;
  if (type === 'builtin') {
    return BUILTIN_KINDS.includes(rest as BuiltinDataKind) ? { type: 'builtin', kind: rest as BuiltinDataKind } : null;
  }
  if (type === 'web_page' || type === 'pdf' || type === 'csv_dashboard' || type === 'visualization') {
    return { type, id: rest };
  }
  return null;
}

/** 全体表示スロットの状態から、選択肢の値を求める（未選択は空文字） */
export function fullChoiceValue(state: {
  fullSlotKind: SignageFullSlotKind;
  fullPdfId: string | null;
  fullCsvDashboardId: string | null;
  fullVisualizationDashboardId: string | null;
  fullWebCaptureId: string | null;
}): string {
  switch (state.fullSlotKind) {
    case 'pdf':
      return state.fullPdfId ? `pdf:${state.fullPdfId}` : '';
    case 'csv_dashboard':
      return state.fullCsvDashboardId ? `csv_dashboard:${state.fullCsvDashboardId}` : '';
    case 'visualization':
      return state.fullVisualizationDashboardId ? `visualization:${state.fullVisualizationDashboardId}` : '';
    case 'web_page':
      return state.fullWebCaptureId ? `web_page:${state.fullWebCaptureId}` : '';
    default:
      return `builtin:${state.fullSlotKind}`;
  }
}

/** 左右分割の片側の状態から、選択肢の値を求める */
export function splitChoiceValue(
  kind: SignageSplitSlotKind,
  ids: { pdfId: string | null; csvDashboardId: string | null; visualizationDashboardId: string | null },
): string {
  if (kind === 'pdf') return ids.pdfId ? `pdf:${ids.pdfId}` : '';
  if (kind === 'csv_dashboard') return ids.csvDashboardId ? `csv_dashboard:${ids.csvDashboardId}` : '';
  if (kind === 'visualization') return ids.visualizationDashboardId ? `visualization:${ids.visualizationDashboardId}` : '';
  return 'builtin:loans';
}

export interface ScheduleDraftForValidation {
  name: string | undefined;
  dayOfWeek: number[] | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  isChatLayout: boolean;
  layoutType: 'FULL' | 'SPLIT';
  fullChoice: string;
  leftChoice: string;
  rightChoice: string;
  fullSlotKind: SignageFullSlotKind;
  kioskDeviceScopeKey: string;
  leaderOrderDeviceScopeKey: string;
  leaderOrderResourceCdsText: string;
  selfInspectionTargetMode: 'kiosk_active_sessions' | 'manual_machine_name';
  selfInspectionMachineName: string;
}

/** 保存前の入力チェック（純関数）。問題がなければ null、あれば最初の 1 件を日本語で返す。 */
export function validateScheduleDraft(draft: ScheduleDraftForValidation): string | null {
  if (!draft.name || draft.name.trim() === '') return '名前を入力してください';
  if (!draft.dayOfWeek || draft.dayOfWeek.length === 0) return '曜日を 1 つ以上選んでください';
  const start = parseTimeToMinutes(draft.startTime ?? '');
  const end = parseTimeToMinutes(draft.endTime ?? '');
  if (start === null || end === null) return '時間を入力してください';
  if (end <= start) return '終わりの時刻は、始まりより後にしてください';
  if (draft.isChatLayout) return null;
  if (draft.layoutType === 'FULL') {
    if (draft.fullChoice === '') return '表示するものを選んでください';
    if (draft.fullSlotKind === 'kiosk_progress_overview' && draft.kioskDeviceScopeKey.trim() === '') {
      return '詳しい設定で、キオスク進捗のスコープキーを入力してください';
    }
    if (draft.fullSlotKind === 'kiosk_leader_order_cards') {
      if (draft.leaderOrderDeviceScopeKey.trim() === '') return '詳しい設定で、順位ボードのスコープキーを入力してください';
      if (parseResourceCdListInput(draft.leaderOrderResourceCdsText).length === 0) {
        return '詳しい設定で、順位ボードの資源CDを 1 件以上入力してください';
      }
    }
    if (
      draft.fullSlotKind === 'self_inspection_machine_board' &&
      draft.selfInspectionTargetMode === 'manual_machine_name' &&
      draft.selfInspectionMachineName.trim() === ''
    ) {
      return '詳しい設定で、自主検査ボードの機種名を入力してください';
    }
    return null;
  }
  if (draft.leftChoice === '' || draft.rightChoice === '') return '左右それぞれに表示するものを選んでください';
  return null;
}

/** 詳しい設定に、その種類ならではの入力欄があるか */
export function fullKindHasDetailFields(kind: SignageFullSlotKind): boolean {
  return (
    kind === 'kiosk_progress_overview' ||
    kind === 'kiosk_leader_order_cards' ||
    kind === 'mobile_placement_parts_shelf_grid' ||
    kind === 'self_inspection_machine_board'
  );
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const EVERY_DAY = [1, 2, 3, 4, 5, 6, 0];

export function sameDays(a: number[] | undefined, b: number[]): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((day, index) => day === right[index]);
}
