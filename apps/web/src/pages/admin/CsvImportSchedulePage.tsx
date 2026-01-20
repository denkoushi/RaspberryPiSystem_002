import axios from 'axios';
import { useMemo, useState, useEffect } from 'react';

import {
  useCsvImportSchedules,
  useCsvImportScheduleMutations,
  useCsvImportSubjectPatterns,
  useCsvImportSubjectPatternMutations
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type {
  CsvImportSchedule,
  CsvImportSubjectPattern,
  CsvImportSubjectPatternType
} from '../../api/backup';

const DAYS_OF_WEEK = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

const SUBJECT_PATTERN_TYPES: Array<{ value: CsvImportSubjectPatternType; label: string }> = [
  { value: 'employees', label: '従業員' },
  { value: 'items', label: 'アイテム' },
  { value: 'measuringInstruments', label: '計測機器' },
  { value: 'riggingGears', label: '吊具' }
];

/**
 * cron形式のスケジュールをUI形式に変換
 * cron形式: "分 時 日 月 曜日" (例: "0 4 * * *" = 毎日4時)
 * UI形式: { time: "04:00", daysOfWeek: [0,1,2,3,4,5,6] } (全て選択時は空配列)
 */
function parseCronSchedule(cronSchedule?: string): { time: string; daysOfWeek: number[] } {
  if (!cronSchedule || !cronSchedule.trim()) {
    return { time: '02:00', daysOfWeek: [] };
  }

  const parts = cronSchedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    // 不正な形式の場合はデフォルト値を返す
    return { time: '02:00', daysOfWeek: [] };
  }

  const minute = parts[0];
  const hour = parts[1];
  const dayOfWeek = parts[4];

  // 時刻を "HH:MM" 形式に変換
  const hourNum = parseInt(hour, 10);
  const minuteNum = parseInt(minute, 10);
  if (isNaN(hourNum) || isNaN(minuteNum)) {
    return { time: '02:00', daysOfWeek: [] };
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
  const hourNum = parseInt(hour || '2', 10);
  const minuteNum = parseInt(minute || '0', 10);

  // 曜日が空配列の場合は全ての曜日（*）を意味する
  const dayOfWeekStr = daysOfWeek.length === 0 ? '*' : daysOfWeek.sort((a, b) => a - b).join(',');

  // cron形式: "分 時 日 月 曜日"
  return `${minuteNum} ${hourNum} * * ${dayOfWeekStr}`;
}

/**
 * cron形式のスケジュールを人間が読みやすい形式に変換
 * cron形式: "0 4 * * 1,2,3" → "毎週月曜日、火曜日、水曜日の午前4時"
 */
function formatScheduleForDisplay(cronSchedule: string): string {
  const parsed = parseCronSchedule(cronSchedule);
  const { time, daysOfWeek } = parsed;
  
  const [hour, minute] = time.split(':');
  const hourNum = parseInt(hour || '0', 10);
  const minuteNum = parseInt(minute || '0', 10);
  
  // 時刻を日本語形式に変換（午前/午後の判定）
  let timeStr: string;
  if (hourNum === 0) {
    timeStr = minuteNum === 0 ? '午前0時' : `午前0時${minuteNum}分`;
  } else if (hourNum < 12) {
    timeStr = minuteNum === 0 ? `午前${hourNum}時` : `午前${hourNum}時${minuteNum}分`;
  } else if (hourNum === 12) {
    timeStr = minuteNum === 0 ? '午後12時' : `午後12時${minuteNum}分`;
  } else {
    const pmHour = hourNum - 12;
    timeStr = minuteNum === 0 ? `午後${pmHour}時` : `午後${pmHour}時${minuteNum}分`;
  }
  
  // 曜日を日本語形式に変換
  if (daysOfWeek.length === 0) {
    return `毎日${timeStr}`;
  }
  
  const dayLabels = daysOfWeek
    .sort((a, b) => a - b)
    .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label)
    .filter(Boolean)
    .join('、');
  
  return `毎週${dayLabels}の${timeStr}`;
}

export function CsvImportSchedulePage() {
  const { data, isLoading, refetch } = useCsvImportSchedules();
  const { create, update, remove, run } = useCsvImportScheduleMutations();
  const { data: subjectPatternData, isLoading: isLoadingPatterns } = useCsvImportSubjectPatterns();
  const { create: createPattern, update: updatePattern, remove: removePattern } =
    useCsvImportSubjectPatternMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [patternDrafts, setPatternDrafts] = useState<CsvImportSubjectPattern[]>([]);
  const [newPatternDrafts, setNewPatternDrafts] = useState<Record<CsvImportSubjectPatternType, {
    pattern: string;
    priority: number;
    enabled: boolean;
  }>>({
    employees: { pattern: '', priority: 0, enabled: true },
    items: { pattern: '', priority: 0, enabled: true },
    measuringInstruments: { pattern: '', priority: 0, enabled: true },
    riggingGears: { pattern: '', priority: 0, enabled: true }
  });

  const schedules = data?.schedules ?? [];

  const subjectPatterns = useMemo(
    () => subjectPatternData?.patterns ?? [],
    [subjectPatternData?.patterns]
  );
  const patternsByType = useMemo(() => {
    const grouped: Record<CsvImportSubjectPatternType, CsvImportSubjectPattern[]> = {
      employees: [],
      items: [],
      measuringInstruments: [],
      riggingGears: []
    };
    for (const pattern of subjectPatterns) {
      grouped[pattern.importType].push(pattern);
    }
    return grouped;
  }, [subjectPatterns]);

  useEffect(() => {
    setPatternDrafts(subjectPatterns.map((pattern) => ({ ...pattern })));
  }, [subjectPatterns]);

  // スケジュールをUI形式で管理
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>([]);

  const [formData, setFormData] = useState<Partial<CsvImportSchedule>>({
    id: '',
    name: '',
    provider: undefined, // デフォルトは未指定（storage.providerを使用）
    targets: [], // 新形式
    employeesPath: '', // 旧形式（後方互換）
    itemsPath: '', // 旧形式（後方互換）
    schedule: '0 2 * * *',
    timezone: 'Asia/Tokyo',
    enabled: true,
    replaceExisting: false,
    autoBackupAfterImport: {
      enabled: false,
      targets: ['csv']
    }
  });

  const formatError = (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { message?: unknown } | undefined;
      const message = typeof data?.message === 'string' ? data.message : undefined;
      return message || error.message;
    }
    return error instanceof Error ? error.message : '操作に失敗しました';
  };

  const handleCreate = async () => {
    setValidationError(null);

    if (!formData.id?.trim()) {
      setValidationError('IDは必須です');
      return;
    }

    // 新形式または旧形式のいずれかが必須
    const hasTargets = formData.targets && formData.targets.length > 0;
    const hasLegacyPaths = formData.employeesPath?.trim() || formData.itemsPath?.trim();
    if (!hasTargets && !hasLegacyPaths) {
      setValidationError('インポート対象を1つ以上指定してください');
      return;
    }

    // UI形式からcron形式に変換
    const cronSchedule = formatCronSchedule(scheduleTime, scheduleDaysOfWeek);

    // 新形式が存在する場合は新形式で保存し、旧形式は空にする
    const scheduleToSave: CsvImportSchedule = {
      ...formData,
      schedule: cronSchedule
    } as CsvImportSchedule;
    
    if (scheduleToSave.targets && scheduleToSave.targets.length > 0) {
      // 新形式で保存する場合は旧形式をクリア
      scheduleToSave.employeesPath = undefined;
      scheduleToSave.itemsPath = undefined;
    } else {
      // 旧形式で保存する場合は新形式をクリア
      scheduleToSave.targets = undefined;
    }

    try {
      await create.mutateAsync(scheduleToSave);
      setShowCreateForm(false);
      setFormData({
        id: '',
        name: '',
        provider: undefined,
        employeesPath: '',
        itemsPath: '',
        schedule: '0 2 * * *',
        timezone: 'Asia/Tokyo',
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: {
          enabled: false,
          targets: ['csv']
        }
      });
      setScheduleTime('02:00');
      setScheduleDaysOfWeek([]);
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const handleUpdate = async (id: string) => {
    setValidationError(null);

    // 新形式または旧形式のいずれかが必須
    const hasTargets = formData.targets && formData.targets.length > 0;
    const hasLegacyPaths = formData.employeesPath?.trim() || formData.itemsPath?.trim();
    if (!hasTargets && !hasLegacyPaths) {
      setValidationError('インポート対象を1つ以上指定してください');
      return;
    }

    // UI形式からcron形式に変換
    const cronSchedule = formatCronSchedule(scheduleTime, scheduleDaysOfWeek);

    // 新形式が存在する場合は新形式で保存し、旧形式は空にする
    const scheduleToSave: Partial<CsvImportSchedule> = {
      ...formData,
      schedule: cronSchedule
    };
    
    if (scheduleToSave.targets && scheduleToSave.targets.length > 0) {
      // 新形式で保存する場合は旧形式をクリア
      scheduleToSave.employeesPath = undefined;
      scheduleToSave.itemsPath = undefined;
    } else if (scheduleToSave.employeesPath || scheduleToSave.itemsPath) {
      // 旧形式で保存する場合は新形式をクリア
      scheduleToSave.targets = undefined;
    }

    try {
      await update.mutateAsync({ id, schedule: scheduleToSave });
      setEditingId(null);
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const handleDelete = async (id: string) => {
    const schedule = schedules.find((s) => s.id === id);

    if (
      !confirm(
        `以下のスケジュールを削除しますか？\n\nID: ${schedule?.id}\n名前: ${schedule?.name || '-'}\nスケジュール: ${schedule?.schedule}\n\nこの操作は取り消せません。`
      )
    ) {
      return;
    }

    try {
      await remove.mutateAsync(id);
      // 削除したスケジュールが編集中だった場合は編集状態をクリア
      if (editingId === id) {
        cancelEdit();
      }
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const handleRun = async (id: string) => {
    const schedule = schedules.find((s) => s.id === id);
    const scheduleName = schedule?.name || schedule?.id || 'このスケジュール';
    const provider = schedule?.provider ? schedule.provider.toUpperCase() : 'デフォルト';
    const paths = schedule?.targets && schedule.targets.length > 0
      ? schedule.targets.map(t => `${t.type}: ${t.source}`).join('\n')
      : [
          schedule?.employeesPath && `従業員: ${schedule.employeesPath}`,
          schedule?.itemsPath && `アイテム: ${schedule.itemsPath}`
        ]
          .filter(Boolean)
          .join('\n');

    if (
      !confirm(
        `以下のスケジュールを手動実行しますか？\n\nID: ${schedule?.id}\n名前: ${scheduleName}\nプロバイダー: ${provider}\n${paths ? `\n${paths}` : ''}\n\nこの操作は即座に実行されます。`
      )
    ) {
      return;
    }

    try {
      await run.mutateAsync(id);
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const startEdit = (schedule: CsvImportSchedule) => {
    setEditingId(schedule.id);
    // 旧形式から新形式への変換（表示用）
    const formDataToSet: Partial<CsvImportSchedule> = { ...schedule };
    if (!formDataToSet.targets && (schedule.employeesPath || schedule.itemsPath)) {
      formDataToSet.targets = [];
      if (schedule.employeesPath) {
        formDataToSet.targets.push({ type: 'employees', source: schedule.employeesPath });
      }
      if (schedule.itemsPath) {
        formDataToSet.targets.push({ type: 'items', source: schedule.itemsPath });
      }
    }
    setFormData(formDataToSet);
    // 既存のスケジュールをUI形式に変換
    const parsed = parseCronSchedule(schedule.schedule);
    setScheduleTime(parsed.time);
    setScheduleDaysOfWeek(parsed.daysOfWeek);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setValidationError(null);
    setFormData({
      id: '',
      name: '',
      provider: undefined,
      targets: [],
      employeesPath: '',
      itemsPath: '',
      schedule: '0 2 * * *',
      timezone: 'Asia/Tokyo',
      enabled: true,
      replaceExisting: false,
      autoBackupAfterImport: {
        enabled: false,
        targets: ['csv']
      }
    });
    setScheduleTime('02:00');
    setScheduleDaysOfWeek([]);
  };

  const handleCancelCreate = () => {
    setShowCreateForm(false);
    setValidationError(null);
    setFormData({
      id: '',
      name: '',
      provider: undefined,
      targets: [],
      employeesPath: '',
      itemsPath: '',
      schedule: '0 2 * * *',
      timezone: 'Asia/Tokyo',
      enabled: true,
      replaceExisting: false,
      autoBackupAfterImport: {
        enabled: false,
        targets: ['csv']
      }
    });
    setScheduleTime('02:00');
    setScheduleDaysOfWeek([]);
  };

  // 新規作成フォームを開いた時にスケジュールの初期値を設定
  useEffect(() => {
    if (showCreateForm) {
      // フォームデータを初期化（編集データや削除後に残った古いデータをクリア）
      setFormData({
        id: '',
        name: '',
        provider: undefined,
        targets: [],
        employeesPath: '',
        itemsPath: '',
        schedule: '0 2 * * *',
        timezone: 'Asia/Tokyo',
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: {
          enabled: false,
          targets: ['csv']
        }
      });
      setScheduleTime('02:00');
      setScheduleDaysOfWeek([]);
    }
  }, [showCreateForm]);

  if (isLoading) {
    return <Card title="CSVインポートスケジュール"><p className="text-sm font-semibold text-slate-700">読み込み中...</p></Card>;
  }

  return (
    <Card
      title="CSVインポートスケジュール"
      action={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={isLoading}
            onClick={() => refetch()}
          >
            一覧更新
          </Button>
          <Button
            onClick={() => {
              // 編集モードがアクティブな場合は先にクリア
              if (editingId !== null) {
                cancelEdit();
              }
              setShowCreateForm(true);
            }}
            disabled={showCreateForm || editingId !== null}
          >
            新規作成
          </Button>
        </div>
      }
    >
      {showCreateForm && (
        <div className="mb-4 rounded-md border-2 border-slate-500 bg-slate-100 p-4 shadow-lg">
          <h3 className="mb-3 text-lg font-bold text-slate-900">新規スケジュール作成</h3>
          
          {validationError && (
            <div className="mb-3 rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
              エラー: {validationError}
            </div>
          )}

          {create.isError && (
            <div className="mb-3 rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
              エラー: {formatError(create.error)}
            </div>
          )}

          {create.isSuccess && (
            <div className="mb-3 rounded-md border-2 border-emerald-700 bg-emerald-600 p-3 text-sm font-semibold text-white shadow-lg">
              スケジュールを作成しました
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                ID *
              </label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                名前
              </label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                プロバイダー（オプション）
              </label>
              <select
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={formData.provider || ''}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value === '' ? undefined : e.target.value as 'dropbox' | 'gmail' })}
              >
                <option value="">デフォルト（設定ファイルのstorage.providerを使用）</option>
                <option value="dropbox">Dropbox</option>
                <option value="gmail">Gmail</option>
              </select>
              <p className="mt-1 text-xs text-slate-600">
                Gmailの場合、sourceは件名パターン（例: [Pi5 CSV Import] employees）を指定します
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                インポート対象 *
              </label>
              <div className="space-y-2">
                {(formData.targets || []).map((target, index) => (
                  <div key={index} className="flex gap-2">
                    <select
                      className="flex-1 rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                      value={target.type}
                      onChange={(e) => {
                        const newTargets = [...(formData.targets || [])];
                        newTargets[index] = { ...target, type: e.target.value as 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' };
                        setFormData({ ...formData, targets: newTargets });
                      }}
                    >
                      <option value="employees">従業員</option>
                      <option value="items">アイテム</option>
                      <option value="measuringInstruments">計測機器</option>
                      <option value="riggingGears">吊具</option>
                    </select>
                    {formData.provider === 'gmail' ? (
                      <select
                        className="flex-1 rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                        value={target.source}
                        onChange={(e) => {
                          const newTargets = [...(formData.targets || [])];
                          newTargets[index] = { ...target, source: e.target.value };
                          setFormData({ ...formData, targets: newTargets });
                        }}
                      >
                        <option value="">選択してください</option>
                        {(patternsByType[target.type] || []).map((pattern) => (
                          <option key={pattern.id} value={pattern.pattern}>
                            {pattern.pattern}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        className="flex-1"
                        placeholder={target.type === 'employees' ? '/backups/csv/employees.csv' : target.type === 'items' ? '/backups/csv/items.csv' : '/backups/csv/...'}
                        value={target.source}
                        onChange={(e) => {
                          const newTargets = [...(formData.targets || [])];
                          newTargets[index] = { ...target, source: e.target.value };
                          setFormData({ ...formData, targets: newTargets });
                        }}
                      />
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const newTargets = (formData.targets || []).filter((_, i) => i !== index);
                        setFormData({ ...formData, targets: newTargets });
                      }}
                      className="text-red-600"
                    >
                      削除
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFormData({
                      ...formData,
                      targets: [...(formData.targets || []), { type: 'employees', source: '' }]
                    });
                  }}
                  className="text-blue-600"
                >
                  + 対象を追加
                </Button>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {formData.provider === 'gmail' 
                  ? 'Gmail検索用の件名パターン（設定された候補から選択）'
                  : 'Dropboxのパス（例: /backups/csv/employees.csv）'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                スケジュール *
              </label>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    実行時刻
                  </label>
                  <Input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
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
                        onClick={() => {
                          const currentDays = scheduleDaysOfWeek;
                          if (currentDays.includes(day.value)) {
                            setScheduleDaysOfWeek(currentDays.filter((d) => d !== day.value));
                          } else {
                            setScheduleDaysOfWeek([...currentDays, day.value]);
                          }
                        }}
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
                  id="enabled"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="rounded border-2 border-slate-500"
                />
                有効
              </label>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  id="replaceExisting"
                  checked={formData.replaceExisting}
                  onChange={(e) => setFormData({ ...formData, replaceExisting: e.target.checked })}
                  className="rounded border-2 border-slate-500"
                />
                既存データを置き換える
              </label>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  id="autoBackupEnabled"
                  checked={formData.autoBackupAfterImport?.enabled}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      autoBackupAfterImport: {
                        ...formData.autoBackupAfterImport,
                        enabled: e.target.checked,
                        targets: formData.autoBackupAfterImport?.targets || ['csv']
                      }
                    })
                  }
                  className="rounded border-2 border-slate-500"
                />
                インポート後に自動バックアップを実行
              </label>
              {formData.autoBackupAfterImport?.enabled && (
                <div className="ml-6 mt-2 space-y-1">
                  <p className="text-xs text-slate-600">バックアップ対象:</p>
                  <div className="flex flex-wrap gap-2">
                    {(['csv', 'database', 'all'] as const).map((target) => (
                      <label key={target} className="flex items-center gap-1 text-xs text-slate-700 font-semibold">
                        <input
                          type="checkbox"
                          checked={formData.autoBackupAfterImport?.targets?.includes(target)}
                          onChange={(e) => {
                            const currentTargets = formData.autoBackupAfterImport?.targets || [];
                            const newTargets = e.target.checked
                              ? [...currentTargets, target]
                              : currentTargets.filter((t) => t !== target);
                            setFormData({
                              ...formData,
                              autoBackupAfterImport: {
                                ...formData.autoBackupAfterImport,
                                enabled: true,
                                targets: newTargets
                              }
                            });
                          }}
                          className="rounded border-2 border-slate-500"
                        />
                        {target === 'csv' ? 'CSV' : target === 'database' ? 'データベース' : 'すべて'}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={create.isPending}>
                {create.isPending ? '作成中...' : '作成'}
              </Button>
              <Button variant="ghost" onClick={handleCancelCreate} disabled={create.isPending}>
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-200 text-slate-900">
            <tr className="border-b-2 border-slate-500">
              <th className="px-2 py-1">ID</th>
              <th className="px-2 py-1">名前</th>
              <th className="px-2 py-1">プロバイダー</th>
              <th className="px-2 py-1">スケジュール</th>
              <th className="px-2 py-1">CSVパス</th>
              <th className="px-2 py-1">状態</th>
              <th className="px-2 py-1">自動バックアップ</th>
              <th className="px-2 py-1">操作</th>
            </tr>
          </thead>
          <tbody>
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-slate-600">
                  スケジュールがありません
                </td>
              </tr>
            ) : (
              schedules.map((schedule) => (
                <tr key={schedule.id} className="border-t border-slate-500">
                  {editingId === schedule.id ? (
                    <>
                      <td className="px-2 py-1">{schedule.id}</td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 text-xs"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <select
                          className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 text-xs"
                          value={formData.provider || ''}
                          onChange={(e) => setFormData({ ...formData, provider: e.target.value === '' ? undefined : e.target.value as 'dropbox' | 'gmail' })}
                        >
                          <option value="">デフォルト</option>
                          <option value="dropbox">Dropbox</option>
                          <option value="gmail">Gmail</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <div className="space-y-2">
                          <Input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="w-full text-xs"
                          />
                          <div className="flex gap-1 flex-wrap">
                            {DAYS_OF_WEEK.map((day) => (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() => {
                                  const currentDays = scheduleDaysOfWeek;
                                  if (currentDays.includes(day.value)) {
                                    setScheduleDaysOfWeek(currentDays.filter((d) => d !== day.value));
                                  } else {
                                    setScheduleDaysOfWeek([...currentDays, day.value]);
                                  }
                                }}
                                className={`rounded-md border-2 px-2 py-0.5 text-xs font-semibold transition-colors ${
                                  scheduleDaysOfWeek.includes(day.value)
                                    ? 'border-emerald-700 bg-emerald-600 text-white'
                                    : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {day.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="space-y-1">
                          {(formData.targets || []).map((target, index) => (
                            <div key={index} className="flex gap-1">
                              <select
                                className="flex-1 rounded-md border-2 border-slate-500 bg-white p-1 text-slate-900 text-xs"
                                value={target.type}
                                onChange={(e) => {
                                  const newTargets = [...(formData.targets || [])];
                                  newTargets[index] = { ...target, type: e.target.value as 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' };
                                  setFormData({ ...formData, targets: newTargets });
                                }}
                              >
                                <option value="employees">従業員</option>
                                <option value="items">アイテム</option>
                                <option value="measuringInstruments">計測機器</option>
                                <option value="riggingGears">吊具</option>
                              </select>
                              {formData.provider === 'gmail' ? (
                                <select
                                  className="flex-1 rounded-md border-2 border-slate-500 bg-white p-1 text-slate-900 text-xs"
                                  value={target.source}
                                  onChange={(e) => {
                                    const newTargets = [...(formData.targets || [])];
                                    newTargets[index] = { ...target, source: e.target.value };
                                    setFormData({ ...formData, targets: newTargets });
                                  }}
                                >
                                  <option value="">選択してください</option>
                                  {(patternsByType[target.type] || []).map((pattern) => (
                                    <option key={pattern.id} value={pattern.pattern}>
                                      {pattern.pattern}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <Input
                                  className="flex-1 text-xs"
                                  placeholder={target.type === 'employees' ? '/backups/csv/employees.csv' : target.type === 'items' ? '/backups/csv/items.csv' : '/backups/csv/...'}
                                  value={target.source}
                                  onChange={(e) => {
                                    const newTargets = [...(formData.targets || [])];
                                    newTargets[index] = { ...target, source: e.target.value };
                                    setFormData({ ...formData, targets: newTargets });
                                  }}
                                />
                              )}
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  const newTargets = (formData.targets || []).filter((_, i) => i !== index);
                                  setFormData({ ...formData, targets: newTargets });
                                }}
                                className="text-red-600 text-xs px-1 py-0.5"
                              >
                                削除
                              </Button>
                            </div>
                          ))}
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setFormData({
                                ...formData,
                                targets: [...(formData.targets || []), { type: 'employees', source: '' }]
                              });
                            }}
                            className="text-blue-600 text-xs px-1 py-0.5"
                          >
                            + 追加
                          </Button>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={formData.enabled}
                          onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        {formData.autoBackupAfterImport?.enabled ? '有効' : '無効'}
                      </td>
                      <td className="px-2 py-1">
                        <div className="space-y-1">
                          {validationError && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              {validationError}
                            </div>
                          )}
                          {update.isError && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              {formatError(update.error)}
                            </div>
                          )}
                          {update.isSuccess && (
                            <div className="rounded-md border border-emerald-600 bg-emerald-50 p-1 text-xs text-emerald-700">
                              更新しました
                            </div>
                          )}
                          <div className="flex gap-1">
                            <Button
                              className="px-2 py-1 text-xs"
                              onClick={() => handleUpdate(schedule.id)}
                              disabled={update.isPending}
                            >
                              {update.isPending ? '保存中...' : '保存'}
                            </Button>
                            <Button
                              className="px-2 py-1 text-xs"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={update.isPending}
                            >
                              キャンセル
                            </Button>
                          </div>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1 font-mono text-xs">{schedule.id}</td>
                      <td className="px-2 py-1">{schedule.name || '-'}</td>
                      <td className="px-2 py-1">
                        <span className="text-xs font-semibold text-slate-700">
                          {schedule.provider ? schedule.provider.toUpperCase() : 'デフォルト'}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-xs">{formatScheduleForDisplay(schedule.schedule)}</td>
                      <td className="px-2 py-1">
                        <div className="space-y-1">
                          {schedule.targets && schedule.targets.length > 0 ? (
                            schedule.targets.map((target, idx) => (
                              <div key={idx} className="text-xs font-mono">
                                {target.type}: {target.source}
                              </div>
                            ))
                          ) : (
                            <>
                              {schedule.employeesPath && (
                                <div className="text-xs font-mono">employees: {schedule.employeesPath}</div>
                              )}
                              {schedule.itemsPath && (
                                <div className="text-xs font-mono">items: {schedule.itemsPath}</div>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <span className={schedule.enabled ? 'text-emerald-400' : 'text-slate-600'}>
                          {schedule.enabled ? '有効' : '無効'}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        {schedule.autoBackupAfterImport?.enabled ? (
                          <span className="text-emerald-400">
                            {schedule.autoBackupAfterImport.targets?.join(', ')}
                          </span>
                        ) : (
                          <span className="text-slate-600">無効</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="space-y-1">
                          {run.isError && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              実行エラー: {formatError(run.error)}
                            </div>
                          )}
                          {run.isSuccess && (
                            <div className="rounded-md border border-emerald-600 bg-emerald-50 p-1 text-xs text-emerald-700">
                              実行しました
                            </div>
                          )}
                          {remove.isError && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              削除エラー: {formatError(remove.error)}
                            </div>
                          )}
                          <div className="flex gap-1">
                            <Button
                              className="px-2 py-1 text-xs"
                              onClick={() => handleRun(schedule.id)}
                              disabled={run.isPending || remove.isPending || update.isPending}
                            >
                              {run.isPending ? '実行中...' : '実行'}
                            </Button>
                            <Button
                              className="px-2 py-1 text-xs"
                              variant="ghost"
                              onClick={() => startEdit(schedule)}
                              disabled={run.isPending || remove.isPending || update.isPending}
                            >
                              編集
                            </Button>
                            <Button
                              className="px-2 py-1 text-xs"
                              variant="ghost"
                              onClick={() => handleDelete(schedule.id)}
                              disabled={remove.isPending || run.isPending || update.isPending}
                            >
                              {remove.isPending ? '削除中...' : '削除'}
                            </Button>
                          </div>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Gmail件名パターン管理（DB） */}
      <div className="mt-8">
        <Card title="Gmail件名パターン管理（DB）">
          {isLoadingPatterns ? (
            <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
          ) : (
            <div className="space-y-6">
              {SUBJECT_PATTERN_TYPES.map((type) => {
                const typePatterns = patternDrafts.filter((p) => p.importType === type.value);
                const newDraft = newPatternDrafts[type.value];
                return (
                  <div key={type.value} className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-700">{type.label}</h4>
                    {typePatterns.length === 0 ? (
                      <p className="text-xs text-slate-600">登録済みの件名パターンがありません</p>
                    ) : (
                      <div className="space-y-2">
                        {typePatterns.map((pattern) => (
                          <div key={pattern.id} className="flex flex-wrap items-center gap-2">
                            <Input
                              className="min-w-[220px] flex-1"
                              value={pattern.pattern}
                              onChange={(e) => {
                                const value = e.target.value;
                                setPatternDrafts((prev) =>
                                  prev.map((item) =>
                                    item.id === pattern.id ? { ...item, pattern: value } : item
                                  )
                                );
                              }}
                            />
                            <Input
                              type="number"
                              className="w-24"
                              value={pattern.priority}
                              onChange={(e) => {
                                const value = Number(e.target.value || 0);
                                setPatternDrafts((prev) =>
                                  prev.map((item) =>
                                    item.id === pattern.id ? { ...item, priority: value } : item
                                  )
                                );
                              }}
                            />
                            <label className="flex items-center gap-1 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={pattern.enabled}
                                onChange={(e) => {
                                  const value = e.target.checked;
                                  setPatternDrafts((prev) =>
                                    prev.map((item) =>
                                      item.id === pattern.id ? { ...item, enabled: value } : item
                                    )
                                  );
                                }}
                                className="rounded border-2 border-slate-500"
                              />
                              有効
                            </label>
                            <Button
                              className="px-3 py-1 text-xs"
                              onClick={() =>
                                updatePattern.mutateAsync({
                                  id: pattern.id,
                                  data: {
                                    pattern: pattern.pattern,
                                    priority: pattern.priority,
                                    enabled: pattern.enabled
                                  }
                                })
                              }
                              disabled={updatePattern.isPending}
                            >
                              {updatePattern.isPending ? '保存中...' : '保存'}
                            </Button>
                            <Button
                              variant="ghost"
                              className="px-3 py-1 text-xs text-red-600"
                              onClick={() => {
                                if (confirm('この件名パターンを削除しますか？')) {
                                  removePattern.mutateAsync(pattern.id);
                                }
                              }}
                              disabled={removePattern.isPending}
                            >
                              削除
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="min-w-[220px] flex-1"
                        placeholder="件名パターンを入力"
                        value={newDraft.pattern}
                        onChange={(e) => {
                          const value = e.target.value;
                          setNewPatternDrafts((prev) => ({
                            ...prev,
                            [type.value]: { ...prev[type.value], pattern: value }
                          }));
                        }}
                      />
                      <Input
                        type="number"
                        className="w-24"
                        value={newDraft.priority}
                        onChange={(e) => {
                          const value = Number(e.target.value || 0);
                          setNewPatternDrafts((prev) => ({
                            ...prev,
                            [type.value]: { ...prev[type.value], priority: value }
                          }));
                        }}
                      />
                      <label className="flex items-center gap-1 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={newDraft.enabled}
                          onChange={(e) => {
                            const value = e.target.checked;
                            setNewPatternDrafts((prev) => ({
                              ...prev,
                              [type.value]: { ...prev[type.value], enabled: value }
                            }));
                          }}
                          className="rounded border-2 border-slate-500"
                        />
                        有効
                      </label>
                      <Button
                        variant="ghost"
                        className="px-3 py-1 text-xs text-blue-600"
                        onClick={async () => {
                          if (!newDraft.pattern.trim()) {
                            alert('件名パターンを入力してください');
                            return;
                          }
                          await createPattern.mutateAsync({
                            importType: type.value,
                            pattern: newDraft.pattern.trim(),
                            priority: newDraft.priority,
                            enabled: newDraft.enabled
                          });
                          setNewPatternDrafts((prev) => ({
                            ...prev,
                            [type.value]: { ...prev[type.value], pattern: '' }
                          }));
                        }}
                        disabled={createPattern.isPending}
                      >
                        {createPattern.isPending ? '追加中...' : '+ 追加'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </Card>
  );
}
