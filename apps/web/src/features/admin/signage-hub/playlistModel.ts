import { formatDays } from '../data-boards/boardModel';

import { classifyScheduleContent, scheduleTargetsClient, type SignageContentKind } from './weekTimelineModel';

import type { BuiltinDataKind } from './hubModel';
import type { SignageLayoutConfig, SignageRotation, SignageSchedule, SignageSlotConfig } from '../../../api/client';

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
/** 「いつも」の時間帯。サーバーの時刻は HH:MM（最大 23:59）で、終わりの分は含まない */
export const ALWAYS_START = '00:00';
export const ALWAYS_END = '23:59';

export interface PlaylistItem {
  scheduleId: string;
  name: string;
  kind: SignageContentKind;
  /** 「いつも」または「平日 7:30–9:00」のような表示 */
  whenLabel: string;
  isAlways: boolean;
  isOnAir: boolean;
  /** いまの時間帯に順番に映しているか（時間外の予定は false） */
  isInRotation: boolean;
  /** 全画面向け（空の対象）か */
  targetsAllScreens: boolean;
}

export function isAlwaysSchedule(schedule: Pick<SignageSchedule, 'dayOfWeek' | 'startTime' | 'endTime'>): boolean {
  return (
    ALL_DAYS.every((day) => schedule.dayOfWeek.includes(day)) &&
    schedule.startTime === ALWAYS_START &&
    schedule.endTime === ALWAYS_END
  );
}

/** 先頭の 0 を外した時刻（07:30 → 7:30） */
function shortTime(value: string): string {
  return value.replace(/^0(\d)/, '$1');
}

export function formatWhen(schedule: Pick<SignageSchedule, 'dayOfWeek' | 'startTime' | 'endTime'>): string {
  if (isAlwaysSchedule(schedule)) return 'いつも';
  const days = formatDays(schedule.dayOfWeek).replace('月〜金', '平日');
  const allDay = schedule.startTime === ALWAYS_START && schedule.endTime === ALWAYS_END;
  return allDay ? `${days} 終日` : `${days} ${shortTime(schedule.startTime)}–${shortTime(schedule.endTime)}`;
}

/**
 * 選んだ画面の「順番に映すもの」を作る（純関数）。
 * いま順番に映しているものをその順で先に、時間外のものを後ろに並べる。
 */
export function buildPlaylist(schedules: SignageSchedule[], clientKey: string | null, rotation: SignageRotation | undefined): PlaylistItem[] {
  const visible = schedules.filter((schedule) => schedule.enabled && scheduleTargetsClient(schedule, clientKey));
  const rotationIds = rotation && !rotation.isFallback ? rotation.scheduleIds : [];
  const onAirId = rotation?.scheduleIds[rotation.currentIndex] ?? null;
  const rank = (schedule: SignageSchedule) => {
    const index = rotationIds.indexOf(schedule.id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return visible
    .map((schedule, index) => ({ schedule, index }))
    .sort((a, b) => rank(a.schedule) - rank(b.schedule) || a.index - b.index)
    .map(({ schedule }) => ({
      scheduleId: schedule.id,
      name: schedule.name,
      kind: classifyScheduleContent(schedule),
      whenLabel: formatWhen(schedule),
      isAlways: isAlwaysSchedule(schedule),
      isOnAir: schedule.id === onAirId,
      isInRotation: rotationIds.includes(schedule.id),
      targetsAllScreens: (schedule.targetClientKeys ?? []).length === 0,
    }));
}

/** 次に映るもの。1 件しかない、または時間外なら null */
export function nextInRotation(rotation: SignageRotation | undefined): { scheduleId: string; secondsUntilSwitch: number } | null {
  if (!rotation || rotation.isFallback || rotation.scheduleIds.length < 2 || rotation.secondsUntilSwitch === null) return null;
  const nextIndex = (rotation.currentIndex + 1) % rotation.scheduleIds.length;
  return { scheduleId: rotation.scheduleIds[nextIndex], secondsUntilSwitch: rotation.secondsUntilSwitch };
}

/** 「映す」で選んだもの */
export type QuickContent =
  | { type: 'web_page'; webCaptureId: string }
  | { type: 'pdf'; pdfId: string; displayMode: 'SLIDESHOW' | 'SINGLE'; slideInterval: number | null }
  | { type: 'csv_dashboard'; csvDashboardId: string }
  | { type: 'visualization'; visualizationDashboardId: string }
  | { type: 'builtin'; kind: Extract<BuiltinDataKind, 'loans' | 'mobile_placement_parts_shelf_grid' | 'self_inspection_machine_board'> };

export interface QuickWhen {
  always: boolean;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
}

export const DEFAULT_QUICK_WHEN: QuickWhen = { always: true, dayOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' };

function slotFor(content: QuickContent): { kind: string; config: SignageSlotConfig | Record<string, never> } {
  switch (content.type) {
    case 'web_page':
      return { kind: 'web_page', config: { webCaptureId: content.webCaptureId } };
    case 'pdf':
      return { kind: 'pdf', config: { pdfId: content.pdfId, displayMode: content.displayMode, slideInterval: content.slideInterval } };
    case 'csv_dashboard':
      return { kind: 'csv_dashboard', config: { csvDashboardId: content.csvDashboardId } };
    case 'visualization':
      return { kind: 'visualization', config: { visualizationDashboardId: content.visualizationDashboardId } };
    case 'builtin':
      return content.kind === 'self_inspection_machine_board'
        ? { kind: content.kind, config: { targetMode: 'kiosk_active_sessions' } }
        : { kind: content.kind, config: {} };
  }
}

/** 「映す」で作る予定の中身（純関数）。全面表示 1 枠で、既定は全画面・いつも。 */
export function buildQuickSchedulePayload(input: { name: string; content: QuickContent; targetClientKeys: string[]; when: QuickWhen }) {
  const slot = slotFor(input.content);
  const layoutConfig = { layout: 'FULL', slots: [{ position: 'FULL', ...slot }] } as SignageLayoutConfig;
  return {
    name: input.name.trim(),
    contentType: input.content.type === 'pdf' ? ('PDF' as const) : ('TOOLS' as const),
    pdfId: input.content.type === 'pdf' ? input.content.pdfId : null,
    layoutConfig,
    targetClientKeys: input.targetClientKeys,
    dayOfWeek: input.when.always ? ALL_DAYS : [...input.when.dayOfWeek].sort((a, b) => a - b),
    startTime: input.when.always ? ALWAYS_START : input.when.startTime,
    endTime: input.when.always ? ALWAYS_END : input.when.endTime,
    priority: 0,
    enabled: true,
  };
}

export type RemoveFromScreenPlan =
  | { action: 'delete'; affectsAllScreens: boolean }
  | { action: 'update'; targetClientKeys: string[] };

/**
 * ある画面のリストから外すとき、予定をどう変えるか（純関数）。
 * ほかの画面にも出している予定は、その画面だけを対象から外す。全画面向けの予定は予定ごと消す。
 */
export function planRemoveFromScreen(schedule: Pick<SignageSchedule, 'targetClientKeys'>, clientKey: string): RemoveFromScreenPlan {
  const keys = schedule.targetClientKeys ?? [];
  if (keys.length === 0) return { action: 'delete', affectsAllScreens: true };
  const remaining = keys.filter((key) => key !== clientKey);
  return remaining.length === 0 ? { action: 'delete', affectsAllScreens: false } : { action: 'update', targetClientKeys: remaining };
}

/** 入力チェック（純関数）。問題がなければ null */
export function validateQuickWhen(when: QuickWhen): string | null {
  if (when.always) return null;
  if (when.dayOfWeek.length === 0) return '曜日を 1 つ以上選んでください';
  if (!/^\d{2}:\d{2}$/.test(when.startTime) || !/^\d{2}:\d{2}$/.test(when.endTime)) return '時間を入力してください';
  if (when.endTime <= when.startTime) return '終わりの時刻は、始まりより後にしてください';
  return null;
}

/**
 * 入力された URL から、撮影に使うパスを取り出す（純関数）。
 * ブラウザのアドレス欄からそのまま貼れるよう、同じサイトのフル URL はパスだけにする。
 */
export function normalizePagePath(input: string, currentOrigin: string): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'ページの URL を入力してください' };
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { ok: false, reason: 'URL を読み取れません' };
    }
    if (url.origin !== currentOrigin) {
      return { ok: false, reason: 'この管理画面・キオスクのページだけ映せます（ほかのサイトは映せません）' };
    }
    return { ok: true, path: `${url.pathname}${url.search}` };
  }
  if (!trimmed.startsWith('/')) return { ok: true, path: `/${trimmed}` };
  return { ok: true, path: trimmed };
}
