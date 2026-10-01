import { useMemo, useState } from 'react';

import { useCsvImportScheduleMutations, useRecentCsvImportHistory } from '../../../api/hooks';

import {
  ALL_DAYS,
  DEFAULT_DURATION_SEC,
  autoAdjust,
  durationsFromHistory,
  findConflicts,
  findRoomiestTiming,
  firesOn,
  formatCronTiming,
  involves,
  parseCronTiming,
  shiftTiming,
  timingEquals,
  type Conflict,
  type ScheduleTiming,
  type TimelineEntry
} from './scheduleTimeline';

import type { CsvImportSchedule } from '../../../api/backup';

/** 未保存の変更（時刻と有効/無効） */
type Draft = ScheduleTiming & { enabled: boolean };

/** 英語名のままのスケジュールに付ける、短い日本語の表示名 */
const DISPLAY_NAMES: Record<string, string> = {
  'csv-import-measuringinstrumentloans': '計測機器 持出返却',
  'csv-import-measuring-instrument-loans': '計測機器 持出返却',
  'csv-import-productionschedule_mishima_grinding': '三島研削 生産日程',
  'csv-import-productionschedule_ordersupplement': '生産日程 注文補足',
  'csv-import-rigging-slings-inspection-powerapps': '吊具点検',
  'csv-import-productionschedule-fkojunst': 'FKOJUNST 生産日程',
  'csv-import-productionschedule-fkojunst-status-mail': 'FKOJUNST ステイタス',
  'csv-import-purchase-order-fkobaino': 'FKOBAINO 購買',
  'csv-import-seiban-machine-name-supplement': '製番→機種名 補完',
  'csv-import-productionschedule-customer-scaw': 'CustomerSCAW 顧客名',
  'csv-import-scaw-stfutekigo': 'ST不適合'
};
const HAS_JAPANESE = /[぀-ヿ一-龯]/;

export function displayNameOf(schedule: Pick<CsvImportSchedule, 'id' | 'name'>): string {
  // 末尾の「 (Gmail)」「 (csvDashboards)」のような補足は一覧では省く
  const name = schedule.name?.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
  if (name && HAS_JAPANESE.test(name)) return name;
  return DISPLAY_NAMES[schedule.id] ?? (name || schedule.id);
}

const FALLBACK_TIMING: ScheduleTiming = { minutes: [0], hours: [0], days: ALL_DAYS };

function isGated(schedule: CsvImportSchedule): boolean {
  return schedule.provider === 'gmail' && (schedule.targets ?? []).some((t) => t.type === 'csvDashboards');
}

/** 毎時の取込（順番待ちの対象→別枠）、1日1回の取込（時刻順）、画面で扱えない cron の順に並べる */
function sortKey(entry: TimelineEntry): number {
  if (!entry.editable) return 1_000_000;
  if (entry.hours === null) return (entry.gated ? 0 : 1_000) + entry.minutes[0];
  return 10_000 + entry.hours[0] * 60 + entry.minutes[0];
}

function busiestHour(entries: TimelineEntry[], day: number): number {
  const counts = Array<number>(24).fill(0);
  for (const entry of entries) {
    if (entry.hours === null) continue;
    for (const t of firesOn(entry, day)) counts[Math.floor(t / 60)] += 1;
  }
  const max = Math.max(...counts);
  return max > 0 ? counts.indexOf(max) : new Date().getHours();
}

export function useCsvImportScheduleBoard(schedules: CsvImportSchedule[]) {
  const { update } = useCsvImportScheduleMutations();
  const { data: historyData } = useRecentCsvImportHistory();

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [day, setDay] = useState(() => new Date().getDay());
  const [hourChoice, setHourChoice] = useState<number | null>(null);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const durations = useMemo(() => durationsFromHistory(historyData?.histories ?? []), [historyData]);

  const savedEntries = useMemo<TimelineEntry[]>(
    () =>
      schedules
        .map((schedule) => {
        const timing = parseCronTiming(schedule.schedule);
        return {
          ...(timing ?? FALLBACK_TIMING),
          id: schedule.id,
          name: displayNameOf(schedule),
          enabled: schedule.enabled,
          gated: isGated(schedule),
          durationSec: durations.get(schedule.id) ?? DEFAULT_DURATION_SEC,
          editable: timing !== null
        };
        })
        .sort((a, b) => sortKey(a) - sortKey(b)),
    [schedules, durations]
  );

  const entries = useMemo(
    () => savedEntries.map((entry) => (drafts[entry.id] ? { ...entry, ...drafts[entry.id] } : entry)),
    [savedEntries, drafts]
  );

  const dirtyIds = useMemo(
    () =>
      entries
        .filter((entry, index) => {
          const saved = savedEntries[index];
          return entry.enabled !== saved.enabled || !timingEquals(entry, saved);
        })
        .map((entry) => entry.id),
    [entries, savedEntries]
  );

  const conflictsByDay = useMemo<Conflict[][]>(() => ALL_DAYS.map((d) => findConflicts(entries, d)), [entries]);
  const hour = hourChoice ?? busiestHour(entries, day);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  const savedSelected = savedEntries.find((entry) => entry.id === selected?.id) ?? null;
  const dirtyHasConflict = conflictsByDay.some((list) => list.some((c) => dirtyIds.some((id) => involves(c, id))));

  const touch = () => {
    setConfirmArmed(false);
    setSaveError(null);
    setNotice(null);
  };

  const patch = (id: string, change: (entry: TimelineEntry) => Partial<Draft>) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const { minutes, hours, days, enabled } = { ...entry, ...change(entry) };
    touch();
    setDrafts((prev) => ({ ...prev, [id]: { minutes, hours, days, enabled } }));
  };

  const nudge = (id: string, delta: number) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const next = shiftTiming(entry, delta);
    patch(id, () => next);
    if (next.hours?.length === 1) setHourChoice(next.hours[0]);
  };

  const select = (id: string) => {
    setSelectedId(id);
    const entry = entries.find((e) => e.id === id);
    const fires = entry ? firesOn(entry, day) : [];
    if (fires.length > 0 && !fires.some((t) => Math.floor(t / 60) === hour)) {
      setHourChoice(Math.floor(fires[0] / 60));
    }
  };

  const revert = (id?: string) => {
    touch();
    setDrafts((prev) => {
      if (!id) return {};
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const moveToRoom = (id: string) => {
    const next = findRoomiestTiming(entries, id);
    if (!next) {
      touch();
      setNotice('空きが見つかりません');
      return;
    }
    patch(id, () => next);
    if (next.hours?.length === 1) setHourChoice(next.hours[0]);
  };

  const runAutoAdjust = () => {
    const result = autoAdjust(entries);
    touch();
    if (result.movedIds.length === 0) {
      setNotice(result.remaining > 0 ? '自動では直せません' : '重なりはありません');
      return;
    }
    setDrafts((prev) => {
      const next = { ...prev };
      for (const entry of result.entries) {
        if (result.movedIds.includes(entry.id)) {
          next[entry.id] = { minutes: entry.minutes, hours: entry.hours, days: entry.days, enabled: entry.enabled };
        }
      }
      return next;
    });
    setSelectedId(result.movedIds[0]);
    setNotice(result.remaining > 0 ? `${result.movedIds.length}件を移動（一部は残っています）` : `${result.movedIds.length}件を移動`);
  };

  const save = async () => {
    if (dirtyIds.length === 0 || isSaving) return;
    if (dirtyHasConflict && !confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      for (const id of dirtyIds) {
        const entry = entries.find((e) => e.id === id)!;
        const saved = savedEntries.find((e) => e.id === id)!;
        const body: Partial<CsvImportSchedule> = {};
        if (!timingEquals(entry, saved)) body.schedule = formatCronTiming(entry);
        if (entry.enabled !== saved.enabled) body.enabled = entry.enabled;
        await update.mutateAsync({ id, schedule: body });
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
      setNotice('保存しました');
    } catch (error) {
      setSaveError(error);
    } finally {
      setIsSaving(false);
      setConfirmArmed(false);
    }
  };

  return {
    entries,
    savedEntries,
    selected,
    savedSelected,
    day,
    hour,
    conflictsByDay,
    dirtyIds,
    dirtyHasConflict,
    confirmArmed,
    saveError,
    notice,
    isSaving,
    hasHistory: (id: string) => durations.has(id),
    setDay: (next: number) => {
      setDay(next);
      setHourChoice(null);
    },
    setHour: setHourChoice,
    select,
    patch,
    nudge,
    revert,
    moveToRoom,
    runAutoAdjust,
    save
  };
}

export type CsvImportScheduleBoardController = ReturnType<typeof useCsvImportScheduleBoard>;
