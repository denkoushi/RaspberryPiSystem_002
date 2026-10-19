import { classifyScheduleContent, type SignageContentKind } from './weekTimelineModel';

import type {
  CsvDashboard,
  SignagePdf,
  SignageSchedule,
  SignageSlot,
  SignageWebCapture,
  VisualizationDashboard,
} from '../../../api/client';

/** 予定に置けるコンテンツ 1 件が、どのスロットに当たるか */
export type LibrarySource =
  | { type: 'web_page'; webCaptureId: string }
  | { type: 'pdf'; pdfId: string }
  | { type: 'csv_dashboard'; csvDashboardId: string }
  | { type: 'visualization'; visualizationDashboardId: string }
  | { type: 'builtin'; kind: BuiltinDataKind }
  | { type: 'chat'; scheduleId: string };

export type BuiltinDataKind =
  | 'loans'
  | 'kiosk_progress_overview'
  | 'kiosk_leader_order_cards'
  | 'mobile_placement_parts_shelf_grid'
  | 'self_inspection_machine_board';

export interface LibraryItem {
  key: string;
  kind: SignageContentKind;
  name: string;
  meta: string;
  /** このコンテンツを使っている有効な予定の数 */
  usedCount: number;
  warning: string | null;
  source: LibrarySource;
}

export const BUILTIN_DATA_ITEMS: Array<{ kind: BuiltinDataKind; name: string }> = [
  { kind: 'loans', name: '持出一覧' },
  { kind: 'self_inspection_machine_board', name: '自主検査 部品別進捗' },
  { kind: 'kiosk_leader_order_cards', name: '順位ボード・資源CDカード' },
  { kind: 'kiosk_progress_overview', name: 'キオスク進捗一覧' },
  { kind: 'mobile_placement_parts_shelf_grid', name: '配膳 部品棚 9枠' },
];

/** 旧形式（layoutConfig なし）も含めて、予定が使うスロットを取り出す */
export function slotsOfSchedule(schedule: Pick<SignageSchedule, 'contentType' | 'pdfId' | 'layoutConfig'>): SignageSlot[] {
  const layout = schedule.layoutConfig;
  if (layout) return layout.layout === 'CANVAS' ? [] : layout.slots;
  const pdfSlot: SignageSlot[] = schedule.pdfId ? [{ position: 'FULL', kind: 'pdf', config: { pdfId: schedule.pdfId } }] : [];
  if (schedule.contentType === 'PDF') return pdfSlot;
  const loans: SignageSlot = { position: 'FULL', kind: 'loans', config: {} };
  return schedule.contentType === 'SPLIT' ? [loans, ...pdfSlot] : [loans];
}

export function slotMatchesSource(slot: SignageSlot, source: LibrarySource): boolean {
  const config = slot.config as SignageSlot['config'] & Record<string, unknown>;
  switch (source.type) {
    case 'web_page':
      return slot.kind === 'web_page' && config.webCaptureId === source.webCaptureId;
    case 'pdf':
      return slot.kind === 'pdf' && config.pdfId === source.pdfId;
    case 'csv_dashboard':
      return slot.kind === 'csv_dashboard' && config.csvDashboardId === source.csvDashboardId;
    case 'visualization':
      return slot.kind === 'visualization' && config.visualizationDashboardId === source.visualizationDashboardId;
    case 'builtin':
      return slot.kind === source.kind;
    case 'chat':
      return false;
  }
}

export function countUsage(schedules: SignageSchedule[], source: LibrarySource): number {
  if (source.type === 'chat') {
    return schedules.some((schedule) => schedule.id === source.scheduleId && schedule.enabled) ? 1 : 0;
  }
  return schedules.filter(
    (schedule) => schedule.enabled && slotsOfSchedule(schedule).some((slot) => slotMatchesSource(slot, source)),
  ).length;
}

const REFRESH_LABEL: Record<number, string> = { 60: '1分ごと', 300: '5分ごと', 900: '15分ごと' };

export interface LibraryInputs {
  schedules: SignageSchedule[];
  webCaptures: SignageWebCapture[];
  pdfs: SignagePdf[];
  csvDashboards: CsvDashboard[];
  visualizationDashboards: VisualizationDashboard[];
}

/** 右列のコンテンツ一覧を組み立てる（純関数）。使用中のものを先に、種類ごとにまとめて並べる。 */
export function buildContentLibrary(inputs: LibraryInputs): LibraryItem[] {
  const { schedules } = inputs;
  const items: LibraryItem[] = [];
  const push = (item: Omit<LibraryItem, 'usedCount'>) => {
    items.push({ ...item, usedCount: countUsage(schedules, item.source) });
  };

  for (const capture of inputs.webCaptures) {
    push({
      key: `web_page:${capture.id}`,
      kind: 'web_page',
      name: capture.name,
      meta: `ページ撮影 · ${REFRESH_LABEL[capture.refreshIntervalSeconds] ?? `${capture.refreshIntervalSeconds}秒ごと`}`,
      warning: !capture.enabled ? '無効' : capture.lastStatus === 'failed' ? '撮影に失敗' : null,
      source: { type: 'web_page', webCaptureId: capture.id },
    });
  }
  for (const dashboard of inputs.visualizationDashboards) {
    push({
      key: `visualization:${dashboard.id}`,
      kind: 'data',
      name: dashboard.name,
      meta: 'データ · グラフ',
      warning: dashboard.enabled ? null : '無効',
      source: { type: 'visualization', visualizationDashboardId: dashboard.id },
    });
  }
  for (const dashboard of inputs.csvDashboards) {
    push({
      key: `csv_dashboard:${dashboard.id}`,
      kind: 'data',
      name: dashboard.name,
      meta: 'データ · 表（CSV）',
      warning: dashboard.enabled ? null : '無効',
      source: { type: 'csv_dashboard', csvDashboardId: dashboard.id },
    });
  }
  for (const builtin of BUILTIN_DATA_ITEMS) {
    push({
      key: `builtin:${builtin.kind}`,
      kind: 'data',
      name: builtin.name,
      meta: 'データ',
      warning: null,
      source: { type: 'builtin', kind: builtin.kind },
    });
  }
  for (const pdf of inputs.pdfs) {
    push({
      key: `pdf:${pdf.id}`,
      kind: 'pdf',
      name: pdf.name,
      meta: pdf.displayMode === 'SLIDESHOW' ? `PDF · ${pdf.slideInterval ?? 30}秒送り` : 'PDF · 1ページ',
      warning: pdf.enabled ? null : '無効',
      source: { type: 'pdf', pdfId: pdf.id },
    });
  }
  for (const schedule of schedules) {
    if (classifyScheduleContent(schedule) !== 'chat') continue;
    push({
      key: `chat:${schedule.id}`,
      kind: 'chat',
      name: schedule.name,
      meta: schedule.enabled ? 'Chat で作成' : 'Chat で作成 · 無効',
      warning: null,
      source: { type: 'chat', scheduleId: schedule.id },
    });
  }

  const kindOrder: Record<SignageContentKind, number> = { web_page: 0, data: 1, pdf: 2, chat: 3 };
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        Number(b.item.usedCount > 0) - Number(a.item.usedCount > 0) ||
        kindOrder[a.item.kind] - kindOrder[b.item.kind] ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

export type DeliveryState = 'ok' | 'stale' | 'never';

export interface DeliveryStatus {
  state: DeliveryState;
  secondsAgo: number | null;
}

/**
 * 端末が最新画像を受け取れているかの判定（純関数）。
 * 端末は約 30 秒ごとに取りに来るので、描画間隔の 3 倍（最低 90 秒）以内なら正常とみなす。
 */
export function judgeDelivery(lastFetchedAt: string | null, now: Date, renderIntervalSeconds: number): DeliveryStatus {
  if (!lastFetchedAt) return { state: 'never', secondsAgo: null };
  const secondsAgo = Math.max(0, Math.round((now.getTime() - new Date(lastFetchedAt).getTime()) / 1000));
  const limit = Math.max(90, renderIntervalSeconds * 3);
  return { state: secondsAgo <= limit ? 'ok' : 'stale', secondsAgo };
}

export function formatAgo(seconds: number | null): string {
  if (seconds === null) return '記録なし';
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間前`;
  return `${Math.floor(seconds / 86400)}日前`;
}
