import { useState, useEffect } from 'react';

import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

import type { BackupTarget } from '../../api/backup';

const DAYS_OF_WEEK = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

interface BackupTargetFormProps {
  initialValues?: BackupTarget;
  onSubmit: (target: Omit<BackupTarget, 'enabled'> & { enabled?: boolean }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

/**
 * cron形式のスケジュールをUI形式に変換
 * cron形式: "分 時 日 月 曜日" (例: "0 4 * * *" = 毎日4時)
 * UI形式: { time: "04:00", daysOfWeek: [0,1,2,3,4,5,6] } (全て選択時は空配列)
 */
function parseCronSchedule(cronSchedule?: string): { time: string; daysOfWeek: number[] } {
  if (!cronSchedule || !cronSchedule.trim()) {
    return { time: '04:00', daysOfWeek: [] };
  }

  const parts = cronSchedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    // 不正な形式の場合はデフォルト値を返す
    return { time: '04:00', daysOfWeek: [] };
  }

  const minute = parts[0];
  const hour = parts[1];
  const dayOfWeek = parts[4];

  // 時刻を "HH:MM" 形式に変換
  const hourNum = parseInt(hour, 10);
  const minuteNum = parseInt(minute, 10);
  if (isNaN(hourNum) || isNaN(minuteNum)) {
    return { time: '04:00', daysOfWeek: [] };
  }
  const time = `${hourNum.toString().padStart(2, '0')}:${minuteNum.toString().padStart(2, '0')}`;

  // 曜日を配列に変換
  let daysOfWeek: number[] = [];
  if (dayOfWeek === '*') {
    // 全ての曜日（空配列で表現）
    daysOfWeek = [];
  } else {
    // カンマ区切りの曜日を配列に変換
    const dayParts = dayOfWeek.split(',');
    daysOfWeek = dayParts
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => !isNaN(d) && d >= 0 && d <= 6);
  }

  return { time, daysOfWeek };
}

/**
 * UI形式からcron形式のスケジュールに変換
 * UI形式: { time: "04:00", daysOfWeek: [1,3,5] }
 * cron形式: "0 4 * * 1,3,5"
 */
function formatCronSchedule(time: string, daysOfWeek: number[]): string {
  const [hour, minute] = time.split(':');
  const hourNum = parseInt(hour || '4', 10);
  const minuteNum = parseInt(minute || '0', 10);

  // 曜日が空配列の場合は全ての曜日（*）を意味する
  const dayOfWeekStr = daysOfWeek.length === 0 ? '*' : daysOfWeek.sort((a, b) => a - b).join(',');

  // cron形式: "分 時 日 月 曜日"
  return `${minuteNum} ${hourNum} * * ${dayOfWeekStr}`;
}

export function BackupTargetForm({ initialValues, onSubmit, onCancel, isLoading }: BackupTargetFormProps) {
  const [kind, setKind] = useState<BackupTarget['kind']>(initialValues?.kind || 'database');
  const [source, setSource] = useState(initialValues?.source || '');
  const [enabled, setEnabled] = useState(initialValues?.enabled ?? true);
  
  // スケジュールをUI形式で管理
  const parsedSchedule = parseCronSchedule(initialValues?.schedule);
  const [scheduleTime, setScheduleTime] = useState(parsedSchedule.time);
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>(parsedSchedule.daysOfWeek);

  const kindId = 'backup-target-kind';
  const sourceId = 'backup-target-source';
  const scheduleTimeId = 'backup-target-schedule-time';
  const scheduleDaysId = 'backup-target-schedule-days';

  useEffect(() => {
    if (initialValues) {
      setKind(initialValues.kind);
      setSource(initialValues.source);
      setEnabled(initialValues.enabled);
      
      // 既存のスケジュールをUI形式に変換
      const parsed = parseCronSchedule(initialValues.schedule);
      setScheduleTime(parsed.time);
      setScheduleDaysOfWeek(parsed.daysOfWeek);
    }
  }, [initialValues]);

  const getSourcePlaceholder = () => {
    switch (kind) {
      case 'database':
        return 'postgresql://postgres:postgres@db:5432/borrow_return';
      case 'csv':
        return 'employees または items';
      case 'image':
        return 'photo-storage';
      case 'file':
        return '/path/to/file.txt';
      case 'directory':
        return '/path/to/directory';
      default:
        return '';
    }
  };

  const toggleDayOfWeek = (day: number) => {
    const currentDays = scheduleDaysOfWeek;
    if (currentDays.includes(day)) {
      setScheduleDaysOfWeek(currentDays.filter((d) => d !== day));
    } else {
      setScheduleDaysOfWeek([...currentDays, day]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim()) {
      alert('ソースを入力してください');
      return;
    }
    
    // UI形式からcron形式に変換
    const cronSchedule = formatCronSchedule(scheduleTime, scheduleDaysOfWeek);
    
    onSubmit({
      kind,
      source: source.trim(),
      schedule: cronSchedule,
      enabled
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={kindId} className="block text-sm font-semibold text-slate-700 mb-1">
          種類 <span className="text-red-600">*</span>
        </label>
        <select
          id={kindId}
          name="kind"
          className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
          value={kind}
          onChange={(e) => setKind(e.target.value as BackupTarget['kind'])}
          disabled={isLoading || !!initialValues}
        >
          <option value="database">データベース</option>
          <option value="csv">CSV</option>
          <option value="image">画像</option>
          <option value="file">ファイル</option>
          <option value="directory">ディレクトリ</option>
        </select>
      </div>

      <div>
        <label htmlFor={sourceId} className="block text-sm font-semibold text-slate-700 mb-1">
          ソース <span className="text-red-600">*</span>
        </label>
        <Input
          id={sourceId}
          name="source"
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={getSourcePlaceholder()}
          disabled={isLoading}
          required
        />
        <p className="mt-1 text-xs text-slate-600">
          {kind === 'database' && 'PostgreSQL接続文字列'}
          {kind === 'csv' && 'employees または items'}
          {kind === 'image' && 'photo-storage（固定値）'}
          {kind === 'file' && 'バックアップ対象のファイルパス'}
          {kind === 'directory' && 'バックアップ対象のディレクトリパス'}
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1">
          スケジュール
        </label>
        <div className="space-y-3">
          <div>
            <label htmlFor={scheduleTimeId} className="block text-xs font-semibold text-slate-600 mb-1">
              実行時刻
            </label>
            <Input
              id={scheduleTimeId}
              name="scheduleTime"
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              disabled={isLoading}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              実行曜日（未選択の場合は毎日）
            </label>
            <div className="flex gap-2 flex-wrap">
              {DAYS_OF_WEEK.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDayOfWeek(day.value)}
                  disabled={isLoading}
                  className={`rounded-md border-2 px-3 py-1 text-sm font-semibold shadow-lg transition-colors ${
                    scheduleDaysOfWeek.includes(day.value)
                      ? 'border-emerald-700 bg-emerald-600 text-white'
                      : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
            {scheduleDaysOfWeek.length === 0 && (
              <p className="mt-1 text-xs text-slate-600">全ての曜日で実行されます</p>
            )}
            {scheduleDaysOfWeek.length > 0 && (
              <p className="mt-1 text-xs text-slate-600">
                選択された曜日: {scheduleDaysOfWeek.sort((a, b) => a - b).map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label).join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={isLoading}
            className="rounded border-2 border-slate-500"
          />
          有効にする
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isLoading || !source.trim()}>
          {isLoading ? '保存中...' : '保存'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isLoading}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
