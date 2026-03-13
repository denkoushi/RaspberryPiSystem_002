import { normalizeMachineName } from '../../../features/kiosk/productionSchedule/machineName';

type DueManagementActiveContextBarProps = {
  selectedFseiban: string | null;
  machineName: string | null;
  dueDateLabel: string;
  triageZoneLabel: string | null;
  isDailyPlanDirty: boolean;
  isSavingDailyPlan: boolean;
  isSavingPartPriorities: boolean;
  isUpdatingDueDate: boolean;
};

export function DueManagementActiveContextBar(props: DueManagementActiveContextBarProps) {
  const activityLabel = props.isSavingDailyPlan
    ? '今日の計画順を保存中'
    : props.isSavingPartPriorities
      ? '部品優先順位を保存中'
      : props.isUpdatingDueDate
        ? '納期日を更新中'
        : props.isDailyPlanDirty
          ? '未保存の変更あり'
          : '保存済み';
  const activityStyle = props.isDailyPlanDirty
    ? 'bg-amber-500/20 text-amber-100 border-amber-300/40'
    : 'bg-emerald-500/20 text-emerald-100 border-emerald-300/40';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-white/90">
      <span className="rounded border border-sky-300/40 bg-sky-500/20 px-2 py-1 font-semibold text-sky-100">
        操作中: <span className="font-mono">{props.selectedFseiban ?? '-'}</span>
      </span>
      <span className="rounded border border-white/25 bg-white/10 px-2 py-1">
        機種: {normalizeMachineName(props.machineName) || '-'}
      </span>
      <span className="rounded border border-white/25 bg-white/10 px-2 py-1">納期: {props.dueDateLabel}</span>
      {props.triageZoneLabel ? (
        <span className="rounded border border-purple-300/40 bg-purple-500/20 px-2 py-1 text-purple-100">
          優先ゾーン: {props.triageZoneLabel}
        </span>
      ) : null}
      <span className={`rounded border px-2 py-1 ${activityStyle}`}>{activityLabel}</span>
    </div>
  );
}
