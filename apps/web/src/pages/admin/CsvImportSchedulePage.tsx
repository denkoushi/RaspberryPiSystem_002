import axios from 'axios';
import { useMemo, useState, useEffect, useRef } from 'react';

import {
  useCsvImportSchedules,
  useCsvImportScheduleMutations,
  useCsvImportSubjectPatterns,
  useCsvImportSubjectPatternMutations,
  useCsvDashboards
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import {
  DAYS_OF_WEEK,
  INTERVAL_PRESETS,
  MIN_INTERVAL_MINUTES,
  formatCronSchedule,
  formatIntervalCronSchedule,
  formatScheduleForDisplay,
  parseCronSchedule,
  type ScheduleMode
} from './csv-import-schedule-utils';

import type {
  CsvImportSchedule,
  CsvImportSubjectPattern,
  CsvImportSubjectPatternType
} from '../../api/backup';

const SUBJECT_PATTERN_TYPES: Array<{ value: CsvImportSubjectPatternType; label: string }> = [
  { value: 'employees', label: '従業員' },
  { value: 'items', label: 'アイテム' },
  { value: 'measuringInstruments', label: '計測機器' },
  { value: 'riggingGears', label: '吊具' },
  { value: 'machines', label: '加工機' },
  { value: 'csvDashboards', label: 'CSVダッシュボード' }
];

export function CsvImportSchedulePage() {
  const { data, isLoading, refetch } = useCsvImportSchedules();
  const { create, update, remove, run } = useCsvImportScheduleMutations();
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);
  const runningScheduleIdRef = useRef<string | null>(null); // 即座に反映される参照（競合防止用）
  const [runError, setRunError] = useState<Record<string, Error | null>>({});
  const [runSuccess, setRunSuccess] = useState<Record<string, boolean>>({});
  const { data: subjectPatternData, isLoading: isLoadingPatterns } = useCsvImportSubjectPatterns();
  const { create: createPattern, update: updatePattern, remove: removePattern } =
    useCsvImportSubjectPatternMutations();
  const { data: csvDashboardsData } = useCsvDashboards({ enabled: true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [patternDrafts, setPatternDrafts] = useState<CsvImportSubjectPattern[]>([]);
  const [subjectPatternDashboardId, setSubjectPatternDashboardId] = useState<string>('');
  const [newPatternDrafts, setNewPatternDrafts] = useState<Record<CsvImportSubjectPatternType, {
    pattern: string;
    priority: number;
    enabled: boolean;
  }>>({
    employees: { pattern: '', priority: 0, enabled: true },
    items: { pattern: '', priority: 0, enabled: true },
    measuringInstruments: { pattern: '', priority: 0, enabled: true },
    riggingGears: { pattern: '', priority: 0, enabled: true },
    machines: { pattern: '', priority: 0, enabled: true },
    csvDashboards: { pattern: '', priority: 0, enabled: true }
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
      riggingGears: [],
      machines: [],
      csvDashboards: []
    };
    for (const pattern of subjectPatterns) {
      grouped[pattern.importType].push(pattern);
    }
    return grouped;
  }, [subjectPatterns]);

  useEffect(() => {
    if (subjectPatternDashboardId) return;
    if (csvDashboardsData && csvDashboardsData.length > 0) {
      setSubjectPatternDashboardId(csvDashboardsData[0].id);
    }
  }, [csvDashboardsData, subjectPatternDashboardId]);

  useEffect(() => {
    setPatternDrafts(subjectPatterns.map((pattern) => ({ ...pattern })));
  }, [subjectPatterns]);

  // スケジュールをUI形式で管理
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>([]);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('timeOfDay');
  const [intervalMinutes, setIntervalMinutes] = useState<string>('10');
  const [scheduleEditable, setScheduleEditable] = useState(true);
  const [scheduleEditWarning, setScheduleEditWarning] = useState<string | null>(null);

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
      if (message) {
        return message;
      }
      if (error.response?.status === 401) {
        return 'Gmailの再認可が必要です。管理コンソールの「Gmail設定」からOAuth認証を実行してください。';
      }
      return error.message;
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

    if (!scheduleEditable || scheduleMode === 'custom') {
      setValidationError('このスケジュール形式はUIから編集できません');
      return;
    }

    let cronSchedule = '';
    if (scheduleMode === 'intervalMinutes') {
      const intervalValue = Number(intervalMinutes);
      if (!Number.isInteger(intervalValue) || intervalValue < MIN_INTERVAL_MINUTES) {
        setValidationError(`間隔は${MIN_INTERVAL_MINUTES}分以上で指定してください`);
        return;
      }
      cronSchedule = formatIntervalCronSchedule(intervalValue, scheduleDaysOfWeek);
    } else {
      // UI形式からcron形式に変換（時刻+曜日）
      cronSchedule = formatCronSchedule(scheduleTime, scheduleDaysOfWeek);
    }

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
      setScheduleMode('timeOfDay');
      setIntervalMinutes('10');
      setScheduleEditable(true);
      setScheduleEditWarning(null);
      refetch();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        await refetch();
        setValidationError(`スケジュールIDが既に存在します: ${formData.id ?? ''}`);
      }
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

    if (!scheduleEditable || scheduleMode === 'custom') {
      setValidationError('このスケジュール形式はUIから編集できません');
      return;
    }

    let cronSchedule = '';
    if (scheduleMode === 'intervalMinutes') {
      const intervalValue = Number(intervalMinutes);
      if (!Number.isInteger(intervalValue) || intervalValue < MIN_INTERVAL_MINUTES) {
        setValidationError(`間隔は${MIN_INTERVAL_MINUTES}分以上で指定してください`);
        return;
      }
      cronSchedule = formatIntervalCronSchedule(intervalValue, scheduleDaysOfWeek);
    } else {
      // UI形式からcron形式に変換
      cronSchedule = formatCronSchedule(scheduleTime, scheduleDaysOfWeek);
    }

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
    // 既に実行中のスケジュールがある場合は早期リターン（useRefで即座にチェック）
    if (runningScheduleIdRef.current !== null) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run-blocked',hypothesisId:'H5',location:'CsvImportSchedulePage.tsx:handleRun',message:'run blocked - already running',data:{scheduleId:id,currentRunningId:runningScheduleIdRef.current},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return;
    }

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

    // 実行中のスケジュールIDを設定（confirm後、実際の実行前に設定）
    // useRefとuseStateの両方を更新（useRefは即座に反映、useStateはUI更新用）
    runningScheduleIdRef.current = id;
    setRunningScheduleId(id);
    setRunError(prev => ({ ...prev, [id]: null }));
    setRunSuccess(prev => ({ ...prev, [id]: false }));
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run-pre',hypothesisId:'H1',location:'CsvImportSchedulePage.tsx:handleRun',message:'manual run confirmed',data:{scheduleId:id,provider,hasTargets:Array.isArray(schedule?.targets),targetsCount:schedule?.targets?.length ?? 0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1',location:'CsvImportSchedulePage.tsx:handleRun',message:'manual run requested',data:{scheduleId:id,provider:provider,targets:(schedule?.targets || []).map(t => ({ type: t.type, source: t.source }))},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      const response = await run.mutateAsync(id);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run-success',hypothesisId:'H1',location:'CsvImportSchedulePage.tsx:handleRun',message:'manual run response received',data:{scheduleId:id,hasSummary:typeof (response as { summary?: unknown })?.summary !== 'undefined'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'verify-step1',hypothesisId:'A',location:'CsvImportSchedulePage.tsx:handleRun',message:'manual run response received',data:{scheduleId:id,response},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      // 取り込みは200でも「部分失敗」があり得る（例: 列不一致で後段処理が失敗）
      // 安全仕様として、失敗が含まれる場合はGmail後処理（既読化/ゴミ箱移動）が行われず、受信箱に残る。
      const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
      const summary = (response as { summary?: unknown })?.summary;
      const dashboardSummaryRaw = isRecord(summary) ? summary.csvDashboards : undefined;
      const dashboardSummary = isRecord(dashboardSummaryRaw) ? dashboardSummaryRaw : undefined;
      const failureMessages: string[] = [];
      if (dashboardSummary && typeof dashboardSummary === 'object') {
        for (const [dashboardId, result] of Object.entries(dashboardSummary)) {
          const debugRaw = isRecord(result) ? result.debug : undefined;
          const debug = isRecord(debugRaw) ? debugRaw : undefined;
          const failed = Array.isArray(debug?.failedMessageIdSuffixes)
            ? debug.failedMessageIdSuffixes.length
            : 0;
          if (failed <= 0) continue;
          const downloaded = Array.isArray(debug?.downloadedMessageIdSuffixes)
            ? debug.downloadedMessageIdSuffixes.length
            : 0;
          const firstError =
            Array.isArray(debug?.errorDetails) &&
            debug.errorDetails.length > 0 &&
            isRecord(debug.errorDetails[0]) &&
            typeof debug.errorDetails[0].error === 'string'
              ? debug.errorDetails[0].error
              : undefined;
          const reason = firstError ? firstError : '不明なエラー';
          failureMessages.push(`- CSVダッシュボード(${dashboardId}): ${reason}（失敗 ${failed}/${downloaded || '?'}）`);
        }
      }
      if (failureMessages.length > 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'gmail-inbox-not-clearing',hypothesisId:'UI',location:'CsvImportSchedulePage.tsx:handleRun',message:'manual run had partial failures; showing warning',data:{scheduleId:id,failureCount:failureMessages.length,firstFailure:failureMessages[0]},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        alert(
          `一部の取り込みに失敗しました。\n\n${failureMessages.join('\n')}\n\n安全のため、該当メールは未読のまま残しています（受信箱が空になりません）。CSV列定義（例: day列）を確認して再実行してください。`
        );
      }
      // 成功状態を設定
      setRunSuccess(prev => ({ ...prev, [id]: true }));
      // 3秒後に成功メッセージを消す
      setTimeout(() => {
        setRunSuccess(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 3000);

      refetch();
    } catch (error) {
      const err = error as {
        message?: string;
        response?: { status?: number; data?: { message?: unknown; errorCode?: unknown } | unknown };
      };
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H2',location:'CsvImportSchedulePage.tsx:handleRun',message:'manual run error',data:{scheduleId:id,errorMessage:err?.message,axiosStatus:err?.response?.status,axiosData:err?.response?.data},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run-error',hypothesisId:'H3',location:'CsvImportSchedulePage.tsx:handleRun',message:'manual run error detail',data:{scheduleId:id,status:err?.response?.status ?? null,apiMessage:typeof (err?.response?.data as { message?: unknown })?.message === 'string' ? (err?.response?.data as { message?: string }).message : null,apiErrorCode:typeof (err?.response?.data as { errorCode?: unknown })?.errorCode === 'string' ? (err?.response?.data as { errorCode?: string }).errorCode : null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setRunError(prev => ({ ...prev, [id]: err as Error }));
    } finally {
      // 実行中のスケジュールIDをクリア（useRefとuseStateの両方をクリア）
      runningScheduleIdRef.current = null;
      setRunningScheduleId(null);
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
    setScheduleMode(parsed.mode === 'custom' ? 'timeOfDay' : parsed.mode);
    setIntervalMinutes(parsed.intervalMinutes ? String(parsed.intervalMinutes) : '10');
    setScheduleEditable(parsed.isEditable);
    setScheduleEditWarning(parsed.isEditable ? null : (parsed.reason || 'このcron形式はUIから編集できません'));
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
    setScheduleMode('timeOfDay');
    setIntervalMinutes('10');
    setScheduleEditable(true);
    setScheduleEditWarning(null);
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
    setScheduleMode('timeOfDay');
    setIntervalMinutes('10');
    setScheduleEditable(true);
    setScheduleEditWarning(null);
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
      setScheduleMode('timeOfDay');
      setIntervalMinutes('10');
      setScheduleEditable(true);
      setScheduleEditWarning(null);
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
                {formData.targets?.some(t => t.type === 'csvDashboards' && t.source) && (
                  <span className="ml-2 text-xs text-slate-500">（CSVダッシュボード選択時に自動生成）</span>
                )}
              </label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={formData.id || ''}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                placeholder={formData.targets?.some(t => t.type === 'csvDashboards' && t.source) ? 'CSVダッシュボード選択時に自動生成されます' : '例: csv-import-measuring-instrument-loans'}
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
                        newTargets[index] = { ...target, type: e.target.value as 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' | 'machines' | 'csvDashboards', source: '' };
                        setFormData({ ...formData, targets: newTargets });
                      }}
                    >
                      <option value="employees">従業員</option>
                      <option value="items">アイテム</option>
                      <option value="measuringInstruments">計測機器</option>
                      <option value="riggingGears">吊具</option>
                      <option value="machines">加工機</option>
                      <option value="csvDashboards">CSVダッシュボード</option>
                    </select>
                    {target.type === 'csvDashboards' ? (
                      <select
                        className="flex-1 rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                        value={target.source}
                        onChange={(e) => {
                          const newTargets = [...(formData.targets || [])];
                          const selectedDashboardId = e.target.value;
                          newTargets[index] = { ...target, source: selectedDashboardId };
                          
                          // ダッシュボード選択時にスケジュールIDと名前を自動設定
                          const selectedDashboard = (csvDashboardsData || []).find(d => d.id === selectedDashboardId);
                          if (selectedDashboard && !formData.id) {
                            // IDが未設定の場合のみ自動生成（編集時は上書きしない）
                            const autoId = `csv-import-${selectedDashboard.name.toLowerCase().replace(/\s+/g, '-')}`;
                            setFormData({
                              ...formData,
                              id: autoId,
                              name: selectedDashboard.name ? `${selectedDashboard.name} (csvDashboards)` : undefined,
                              targets: newTargets
                            });
                          } else {
                            setFormData({ ...formData, targets: newTargets });
                          }
                        }}
                        required
                      >
                        <option value="">CSVダッシュボードを選択してください</option>
                        {(csvDashboardsData || []).map((dashboard) => (
                          <option key={dashboard.id} value={dashboard.id}>
                            {dashboard.name}
                          </option>
                        ))}
                      </select>
                    ) : formData.provider === 'gmail' ? (
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
                        placeholder={target.type === 'employees' ? '/backups/csv/employees.csv' : target.type === 'items' ? '/backups/csv/items.csv' : target.type === 'machines' ? '/backups/csv/machines.csv' : '/backups/csv/...'}
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
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleMode('timeOfDay')}
                    className={`rounded-md border-2 px-3 py-1 text-xs font-semibold transition-colors ${
                      scheduleMode === 'timeOfDay'
                        ? 'border-emerald-700 bg-emerald-600 text-white'
                        : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    時刻指定
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('intervalMinutes')}
                    className={`rounded-md border-2 px-3 py-1 text-xs font-semibold transition-colors ${
                      scheduleMode === 'intervalMinutes'
                        ? 'border-emerald-700 bg-emerald-600 text-white'
                        : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    間隔指定（N分ごと）
                  </button>
                </div>
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
                          onChange={(e) => setIntervalMinutes(e.target.value)}
                        />
                        <span className="text-xs text-slate-600">分ごと</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {INTERVAL_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setIntervalMinutes(String(preset))}
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
                        最小{MIN_INTERVAL_MINUTES}分。負荷を考慮して短すぎる間隔は避けてください。
                      </p>
                    </div>
                  ) : (
                    <Input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                    />
                  )}
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
                          {scheduleEditWarning && (
                            <div className="rounded-md border border-amber-600 bg-amber-50 p-1 text-xs text-amber-700">
                              {scheduleEditWarning}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => setScheduleMode('timeOfDay')}
                              disabled={!scheduleEditable}
                              className={`rounded-md border-2 px-2 py-0.5 text-xs font-semibold transition-colors ${
                                scheduleMode === 'timeOfDay'
                                  ? 'border-emerald-700 bg-emerald-600 text-white'
                                  : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
                              } ${!scheduleEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              時刻
                            </button>
                            <button
                              type="button"
                              onClick={() => setScheduleMode('intervalMinutes')}
                              disabled={!scheduleEditable}
                              className={`rounded-md border-2 px-2 py-0.5 text-xs font-semibold transition-colors ${
                                scheduleMode === 'intervalMinutes'
                                  ? 'border-emerald-700 bg-emerald-600 text-white'
                                  : 'border-slate-500 bg-white text-slate-700 hover:bg-slate-100'
                              } ${!scheduleEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              間隔
                            </button>
                          </div>
                          {scheduleMode === 'intervalMinutes' ? (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={MIN_INTERVAL_MINUTES}
                                value={intervalMinutes}
                                onChange={(e) => setIntervalMinutes(e.target.value)}
                                className="w-full text-xs"
                                disabled={!scheduleEditable}
                              />
                              <span className="text-[10px] text-slate-600">分ごと</span>
                            </div>
                          ) : (
                            <Input
                              type="time"
                              value={scheduleTime}
                              onChange={(e) => setScheduleTime(e.target.value)}
                              className="w-full text-xs"
                              disabled={!scheduleEditable}
                            />
                          )}
                          <div className="flex gap-1 flex-wrap">
                            {DAYS_OF_WEEK.map((day) => (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() => {
                                  if (!scheduleEditable) return;
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
                                } ${!scheduleEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                                  newTargets[index] = { ...target, type: e.target.value as 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' | 'machines' | 'csvDashboards', source: '' };
                                  setFormData({ ...formData, targets: newTargets });
                                }}
                              >
                                <option value="employees">従業員</option>
                                <option value="items">アイテム</option>
                                <option value="measuringInstruments">計測機器</option>
                                <option value="riggingGears">吊具</option>
                                <option value="machines">加工機</option>
                                <option value="csvDashboards">CSVダッシュボード</option>
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
                                  {(target.type !== 'csvDashboards' && patternsByType[target.type as CsvImportSubjectPatternType] || []).map((pattern) => (
                                    <option key={pattern.id} value={pattern.pattern}>
                                      {pattern.pattern}
                                    </option>
                                  ))}
                                </select>
                              ) : target.type === 'csvDashboards' ? (
                                <select
                                  className="flex-1 rounded-md border-2 border-slate-500 bg-white p-1 text-slate-900 text-xs"
                                  value={target.source}
                                  onChange={(e) => {
                                    const newTargets = [...(formData.targets || [])];
                                    const selectedDashboardId = e.target.value;
                                    newTargets[index] = { ...target, source: selectedDashboardId };
                                    
                                    // ダッシュボード選択時にスケジュールIDと名前を自動設定（編集時はIDを変更しない）
                                    const selectedDashboard = (csvDashboardsData || []).find(d => d.id === selectedDashboardId);
                                    if (selectedDashboard && !editingId && !formData.id) {
                                      // 新規作成時のみIDを自動生成
                                      const autoId = `csv-import-${selectedDashboard.name.toLowerCase().replace(/\s+/g, '-')}`;
                                      setFormData({
                                        ...formData,
                                        id: autoId,
                                        name: selectedDashboard.name ? `${selectedDashboard.name} (csvDashboards)` : formData.name,
                                        targets: newTargets
                                      });
                                    } else {
                                      setFormData({ ...formData, targets: newTargets });
                                    }
                                  }}
                                  required
                                >
                                  <option value="">CSVダッシュボードを選択してください</option>
                                  {(csvDashboardsData || []).map((dashboard) => (
                                    <option key={dashboard.id} value={dashboard.id}>
                                      {dashboard.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <Input
                                  className="flex-1 text-xs"
                                  placeholder={target.type === 'employees' ? '/backups/csv/employees.csv' : target.type === 'items' ? '/backups/csv/items.csv' : target.type === 'machines' ? '/backups/csv/machines.csv' : '/backups/csv/...'}
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
                              disabled={update.isPending || !scheduleEditable}
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
                          {runError[schedule.id] && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              実行エラー: {formatError(runError[schedule.id])}
                            </div>
                          )}
                          {runSuccess[schedule.id] && (
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
                              disabled={runningScheduleId === schedule.id || runningScheduleId !== null || remove.isPending || update.isPending}
                            >
                              {runningScheduleId === schedule.id ? '実行中...' : '実行'}
                            </Button>
                            <Button
                              className="px-2 py-1 text-xs"
                              variant="ghost"
                              onClick={() => startEdit(schedule)}
                              disabled={runningScheduleId !== null || remove.isPending || update.isPending}
                            >
                              編集
                            </Button>
                            <Button
                              className="px-2 py-1 text-xs"
                              variant="ghost"
                              onClick={() => handleDelete(schedule.id)}
                              disabled={remove.isPending || runningScheduleId !== null || update.isPending}
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
                const typePatterns = patternDrafts.filter((p) => {
                  if (p.importType !== type.value) return false;
                  if (type.value === 'csvDashboards') {
                    return p.dashboardId === subjectPatternDashboardId;
                  }
                  return true;
                });
                const newDraft = newPatternDrafts[type.value];
                return (
                  <div key={type.value} className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-700">{type.label}</h4>
                    {type.value === 'csvDashboards' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs font-semibold text-slate-600">対象ダッシュボード</label>
                        <select
                          className="min-w-[220px] rounded-md border-2 border-slate-500 bg-white p-2 text-xs font-semibold text-slate-900"
                          value={subjectPatternDashboardId}
                          onChange={(e) => setSubjectPatternDashboardId(e.target.value)}
                        >
                          <option value="">選択してください</option>
                          {(csvDashboardsData || []).map((dashboard) => (
                            <option key={dashboard.id} value={dashboard.id}>
                              {dashboard.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
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
                                if (type.value === 'csvDashboards' && !subjectPatternDashboardId) {
                                  alert('CSVダッシュボードを選択してください');
                                  return;
                                }
                          await createPattern.mutateAsync({
                            importType: type.value,
                                  dashboardId: type.value === 'csvDashboards' ? subjectPatternDashboardId : undefined,
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
