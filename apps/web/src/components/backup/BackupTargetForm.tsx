import { useState, useEffect, useCallback } from 'react';

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
  storageProvider?: 'local' | 'dropbox';
  storagePath?: string;
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

export function BackupTargetForm({ initialValues, onSubmit, onCancel, isLoading, storageProvider: defaultStorageProvider = 'local', storagePath = '/opt/backups' }: BackupTargetFormProps) {
  const [kind, setKind] = useState<BackupTarget['kind']>(initialValues?.kind || 'database');
  const [source, setSource] = useState(initialValues?.source || '');
  const [enabled, setEnabled] = useState(initialValues?.enabled ?? true);
  
  // スケジュールをUI形式で管理
  const parsedSchedule = parseCronSchedule(initialValues?.schedule);
  const [scheduleTime, setScheduleTime] = useState(parsedSchedule.time);
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>(parsedSchedule.daysOfWeek);
  
  // 保持期間設定（Phase 3）
  const [retentionDays, setRetentionDays] = useState<number | undefined>(initialValues?.retention?.days);
  const [retentionMaxBackups, setRetentionMaxBackups] = useState<number | undefined>(initialValues?.retention?.maxBackups);
  
  // バックアップ先の選択（Phase 2: 複数選択対応）
  // providers配列が指定されている場合はそれを使用、providerが指定されている場合は配列に変換、未指定の場合は空配列（デフォルト）
  const getInitialProviders = useCallback((): ('local' | 'dropbox')[] => {
    if (initialValues?.storage?.providers && initialValues.storage.providers.length > 0) {
      return initialValues.storage.providers;
    }
    if (initialValues?.storage?.provider) {
      return [initialValues.storage.provider];
    }
    return []; // 空配列は「システム設定を使用」を意味する
  }, [initialValues?.storage?.providers, initialValues?.storage?.provider]);
  const [selectedProviders, setSelectedProviders] = useState<('local' | 'dropbox')[]>(getInitialProviders());
  
  const getStorageProviderLabel = (provider: 'local' | 'dropbox') => {
    return provider === 'dropbox' ? 'Dropbox' : 'ローカルストレージ';
  };
  
  const toggleProvider = (provider: 'local' | 'dropbox') => {
    setSelectedProviders((prev) => {
      if (prev.includes(provider)) {
        return prev.filter((p) => p !== provider);
      } else {
        return [...prev, provider];
      }
    });
  };

  const kindId = 'backup-target-kind';
  const sourceId = 'backup-target-source';
  const scheduleTimeId = 'backup-target-schedule-time';

  useEffect(() => {
    if (initialValues) {
      setKind(initialValues.kind);
      setSource(initialValues.source);
      setEnabled(initialValues.enabled);
      
      // 既存のスケジュールをUI形式に変換
      const parsed = parseCronSchedule(initialValues.schedule);
      setScheduleTime(parsed.time);
      setScheduleDaysOfWeek(parsed.daysOfWeek);
      
      // 既存のストレージプロバイダー設定を反映
      setSelectedProviders(getInitialProviders());
      
      // 既存の保持期間設定を反映（Phase 3）
      setRetentionDays(initialValues.retention?.days);
      setRetentionMaxBackups(initialValues.retention?.maxBackups);
    }
  }, [initialValues, getInitialProviders]);

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
    
    // ストレージプロバイダーの設定（Phase 2: 複数選択対応）
    // 選択されていない場合はundefinedにして全体設定を使用
    // 1つの場合はprovider、複数の場合はprovidersを使用
    const storage = selectedProviders.length === 0
      ? undefined
      : selectedProviders.length === 1
      ? { provider: selectedProviders[0] }
      : { providers: selectedProviders };
    
    // 保持期間設定（Phase 3）
    const retention = (retentionDays !== undefined || retentionMaxBackups !== undefined)
      ? {
          days: retentionDays,
          maxBackups: retentionMaxBackups
        }
      : undefined;
    
    onSubmit({
      kind,
      source: source.trim(),
      schedule: cronSchedule,
      enabled,
      storage,
      retention
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
          バックアップ先（複数選択可）
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={selectedProviders.length === 0}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedProviders([]);
                }
              }}
              disabled={isLoading}
              className="rounded border-2 border-slate-500"
            />
            <span>システム設定を使用（{getStorageProviderLabel(defaultStorageProvider)}）</span>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={selectedProviders.includes('local')}
              onChange={() => toggleProvider('local')}
              disabled={isLoading || selectedProviders.length === 0}
              className="rounded border-2 border-slate-500"
            />
            <span>ローカルストレージ</span>
            {selectedProviders.includes('local') && (
              <span className="text-xs text-slate-600 font-mono">({storagePath})</span>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={selectedProviders.includes('dropbox')}
              onChange={() => toggleProvider('dropbox')}
              disabled={isLoading || selectedProviders.length === 0}
              className="rounded border-2 border-slate-500"
            />
            <span>Dropbox</span>
            {selectedProviders.includes('dropbox') && (
              <span className="text-xs text-slate-600 font-mono">({storagePath.replace('/opt/backups', '/backups')})</span>
            )}
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          {selectedProviders.length === 0 && `現在のシステム設定: ${getStorageProviderLabel(defaultStorageProvider)}`}
          {selectedProviders.length === 1 && `選択されたプロバイダー: ${getStorageProviderLabel(selectedProviders[0])}`}
          {selectedProviders.length > 1 && `選択されたプロバイダー: ${selectedProviders.map(getStorageProviderLabel).join(', ')}（多重バックアップ）`}
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
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          保持期間設定（オプション）
        </label>
        <div className="space-y-2 pl-4 border-l-2 border-slate-300">
          <div>
            <label htmlFor="retention-days" className="block text-xs font-semibold text-slate-600 mb-1">
              保持日数（日）
            </label>
            <Input
              id="retention-days"
              name="retentionDays"
              type="number"
              min="1"
              value={retentionDays ?? ''}
              onChange={(e) => setRetentionDays(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              disabled={isLoading}
              placeholder="例: 30"
              className="w-full"
            />
            <p className="mt-1 text-xs text-slate-600">
              指定した日数を超えたバックアップは自動削除されます。未指定の場合は全体設定を使用します。
            </p>
          </div>
          <div>
            <label htmlFor="retention-max-backups" className="block text-xs font-semibold text-slate-600 mb-1">
              最大保持数（件）
            </label>
            <Input
              id="retention-max-backups"
              name="retentionMaxBackups"
              type="number"
              min="1"
              value={retentionMaxBackups ?? ''}
              onChange={(e) => setRetentionMaxBackups(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              disabled={isLoading}
              placeholder="例: 10"
              className="w-full"
            />
            <p className="mt-1 text-xs text-slate-600">
              指定した件数を超えたバックアップは古いものから自動削除されます。未指定の場合は保持日数のみが適用されます。
            </p>
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
