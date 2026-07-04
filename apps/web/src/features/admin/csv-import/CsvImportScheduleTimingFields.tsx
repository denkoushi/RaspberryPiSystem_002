import { Input } from '../../../components/ui/Input';

import {
  DAYS_OF_WEEK,
  INTERVAL_PRESETS,
  MIN_INTERVAL_MINUTES,
  type ScheduleMode
} from './csvImportScheduleUtils';

type CsvImportScheduleTimingFieldsProps = {
  variant: 'create' | 'edit';
  scheduleMode: ScheduleMode;
  scheduleTime: string;
  scheduleDaysOfWeek: number[];
  intervalMinutes: string;
  offsetMinutes: string;
  scheduleEditable: boolean;
  scheduleEditWarning: string | null;
  onScheduleModeChange: (mode: ScheduleMode) => void;
  onScheduleTimeChange: (value: string) => void;
  onScheduleDaysOfWeekChange: (value: number[]) => void;
  onIntervalMinutesChange: (value: string) => void;
  onOffsetMinutesChange: (value: string) => void;
};

export function CsvImportScheduleTimingFields({
  variant,
  scheduleMode,
  scheduleTime,
  scheduleDaysOfWeek,
  intervalMinutes,
  offsetMinutes,
  scheduleEditable,
  scheduleEditWarning,
  onScheduleModeChange,
  onScheduleTimeChange,
  onScheduleDaysOfWeekChange,
  onIntervalMinutesChange,
  onOffsetMinutesChange
}: CsvImportScheduleTimingFieldsProps) {
  const isCreate = variant === 'create';

  const toggleDay = (dayValue: number) => {
    if (!isCreate && !scheduleEditable) return;
    const currentDays = scheduleDaysOfWeek;
    if (currentDays.includes(dayValue)) {
      onScheduleDaysOfWeekChange(currentDays.filter((d) => d !== dayValue));
    } else {
      onScheduleDaysOfWeekChange([...currentDays, dayValue]);
    }
  };

  const timingContent = (
    <div className={isCreate ? 'space-y-3' : 'space-y-2'}>
      {!isCreate && scheduleEditWarning && (
        <div className="rounded-md border border-amber-600 bg-amber-50 p-1 text-xs text-amber-700">
          {scheduleEditWarning}
        </div>
      )}
      <div className={`flex flex-wrap ${isCreate ? 'gap-2' : 'gap-1'}`}>
        <button
          type="button"
          onClick={() => onScheduleModeChange('timeOfDay')}
          disabled={!isCreate && !scheduleEditable}
          className={`rounded-md border-2 ${isCreate ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-xs'} font-semibold transition-colors ${
            scheduleMode === 'timeOfDay'
              ? 'border-emerald-700 bg-emerald-600 text-white'
              : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
          } ${!isCreate && !scheduleEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {isCreate ? '時刻指定' : '時刻'}
        </button>
        <button
          type="button"
          onClick={() => onScheduleModeChange('intervalMinutes')}
          disabled={!isCreate && !scheduleEditable}
          className={`rounded-md border-2 ${isCreate ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-xs'} font-semibold transition-colors ${
            scheduleMode === 'intervalMinutes'
              ? 'border-emerald-700 bg-emerald-600 text-white'
              : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
          } ${!isCreate && !scheduleEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {isCreate ? '間隔指定（N分ごと）' : '間隔'}
        </button>
      </div>
      {isCreate ? (
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            {scheduleMode === 'intervalMinutes' ? '実行間隔' : '実行時刻'}
          </label>
          {scheduleMode === 'intervalMinutes' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={MIN_INTERVAL_MINUTES}
                  value={intervalMinutes}
                  onChange={(e) => onIntervalMinutesChange(e.target.value)}
                />
                <span className="text-xs text-slate-600">分ごと</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={offsetMinutes}
                  onChange={(e) => onOffsetMinutesChange(e.target.value)}
                />
                <span className="text-xs text-slate-600">分開始（オフセット）</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {INTERVAL_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onIntervalMinutesChange(String(preset))}
                    className={`rounded-md border-2 px-2 py-0.5 text-xs font-semibold transition-colors ${
                      intervalMinutes === String(preset)
                        ? 'border-emerald-700 bg-emerald-600 text-white'
                        : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preset}分
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-600">
                最小{MIN_INTERVAL_MINUTES}分。オフセットを指定すると「15,25,35...」のような分リストで保存し、同時発火を避けられます。
              </p>
            </div>
          ) : (
            <Input
              type="time"
              value={scheduleTime}
              onChange={(e) => onScheduleTimeChange(e.target.value)}
            />
          )}
        </div>
      ) : scheduleMode === 'intervalMinutes' ? (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={MIN_INTERVAL_MINUTES}
            value={intervalMinutes}
            onChange={(e) => onIntervalMinutesChange(e.target.value)}
            className="w-full text-xs"
            disabled={!scheduleEditable}
          />
          <span className="text-[10px] text-slate-600">分ごと</span>
        </div>
      ) : (
        <Input
          type="time"
          value={scheduleTime}
          onChange={(e) => onScheduleTimeChange(e.target.value)}
          className="w-full text-xs"
          disabled={!scheduleEditable}
        />
      )}
      <div>
        {isCreate && (
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            実行曜日（未選択の場合は毎日）
          </label>
        )}
        <div className={isCreate ? 'flex gap-2 flex-wrap' : 'flex gap-1 flex-wrap'}>
          {DAYS_OF_WEEK.map((day) => (
            <button
              key={day.value}
              type="button"
              onClick={() => toggleDay(day.value)}
              className={`rounded-md border-2 ${isCreate ? 'px-3 py-1 text-sm shadow-lg' : 'px-2 py-0.5 text-xs'} font-semibold transition-colors ${
                scheduleDaysOfWeek.includes(day.value)
                  ? 'border-emerald-700 bg-emerald-600 text-white'
                  : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
              } ${!isCreate && !scheduleEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {day.label}
            </button>
          ))}
        </div>
        {isCreate && scheduleDaysOfWeek.length === 0 && (
          <p className="mt-1 text-xs text-slate-600">全ての曜日で実行されます</p>
        )}
        {isCreate && scheduleDaysOfWeek.length > 0 && (
          <p className="mt-1 text-xs text-slate-600">
            選択された曜日: {scheduleDaysOfWeek.sort((a, b) => a - b).map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label).join(', ')}
          </p>
        )}
      </div>
      {!isCreate && scheduleMode === 'intervalMinutes' && (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            max={59}
            value={offsetMinutes}
            onChange={(e) => onOffsetMinutesChange(e.target.value)}
            className="w-full text-xs"
            disabled={!scheduleEditable}
          />
          <span className="text-[10px] text-slate-600">分開始</span>
        </div>
      )}
    </div>
  );

  if (isCreate) {
    return (
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1">
          スケジュール *
        </label>
        {timingContent}
      </div>
    );
  }

  return timingContent;
}
