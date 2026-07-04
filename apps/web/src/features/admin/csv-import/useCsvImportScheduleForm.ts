import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';

import {
  useCsvImportScheduleMutations,
  useCsvImportSchedules
} from '../../../api/hooks';

import {
  formatCronSchedule,
  formatOffsetIntervalCronSchedule,
  MIN_INTERVAL_MINUTES,
  parseCronSchedule,
  type ScheduleMode
} from './csvImportScheduleUtils';

import type { CsvImportSchedule, CsvImportSubjectPattern, CsvImportSubjectPatternType } from '../../../api/backup';

export const DEFAULT_CSV_IMPORT_FORM_DATA: Partial<CsvImportSchedule> = {
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
};

export function resetCsvImportScheduleUiState(setters: {
  setFormData: (value: Partial<CsvImportSchedule>) => void;
  setScheduleTime: (value: string) => void;
  setScheduleDaysOfWeek: (value: number[]) => void;
  setScheduleMode: (value: ScheduleMode) => void;
  setIntervalMinutes: (value: string) => void;
  setOffsetMinutes: (value: string) => void;
  setScheduleEditable: (value: boolean) => void;
  setScheduleEditWarning: (value: string | null) => void;
}) {
  setters.setFormData({ ...DEFAULT_CSV_IMPORT_FORM_DATA });
  setters.setScheduleTime('02:00');
  setters.setScheduleDaysOfWeek([]);
  setters.setScheduleMode('timeOfDay');
  setters.setIntervalMinutes('10');
  setters.setOffsetMinutes('0');
  setters.setScheduleEditable(true);
  setters.setScheduleEditWarning(null);
}

type UseCsvImportScheduleFormOptions = {
  subjectPatterns: CsvImportSubjectPattern[];
};

export function useCsvImportScheduleForm({ subjectPatterns }: UseCsvImportScheduleFormOptions) {
  const { data, isLoading, refetch } = useCsvImportSchedules();
  const { create, update, remove } = useCsvImportScheduleMutations();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);

  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>([]);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('timeOfDay');
  const [intervalMinutes, setIntervalMinutes] = useState<string>('10');
  const [offsetMinutes, setOffsetMinutes] = useState<string>('0');
  const [scheduleEditable, setScheduleEditable] = useState(true);
  const [scheduleEditWarning, setScheduleEditWarning] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<CsvImportSchedule>>({ ...DEFAULT_CSV_IMPORT_FORM_DATA });

  const schedules = data?.schedules ?? [];
  const listWarnings = data?.warnings ?? [];
  const displayedScheduleWarnings = saveWarnings.length > 0 ? saveWarnings : listWarnings;

  const clearScheduleWarnings = () => {
    setSaveWarnings([]);
  };

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

  const resetUiState = () => {
    resetCsvImportScheduleUiState({
      setFormData,
      setScheduleTime,
      setScheduleDaysOfWeek,
      setScheduleMode,
      setIntervalMinutes,
      setOffsetMinutes,
      setScheduleEditable,
      setScheduleEditWarning
    });
  };

  const buildCronSchedule = (): string | null => {
    if (!scheduleEditable || scheduleMode === 'custom') {
      setValidationError('このスケジュール形式はUIから編集できません');
      return null;
    }

    if (scheduleMode === 'intervalMinutes') {
      const intervalValue = Number(intervalMinutes);
      if (!Number.isInteger(intervalValue) || intervalValue < MIN_INTERVAL_MINUTES) {
        setValidationError(`間隔は${MIN_INTERVAL_MINUTES}分以上で指定してください`);
        return null;
      }
      const offsetValue = Number(offsetMinutes);
      if (!Number.isInteger(offsetValue) || offsetValue < 0 || offsetValue > 59) {
        setValidationError('開始分（オフセット）は 0〜59 で指定してください');
        return null;
      }
      return formatOffsetIntervalCronSchedule(intervalValue, offsetValue, scheduleDaysOfWeek);
    }

    return formatCronSchedule(scheduleTime, scheduleDaysOfWeek);
  };

  const handleCreate = async () => {
    setValidationError(null);
    clearScheduleWarnings();

    if (!formData.id?.trim()) {
      setValidationError('IDは必須です');
      return;
    }

    const hasTargets = formData.targets && formData.targets.length > 0;
    const hasLegacyPaths = formData.employeesPath?.trim() || formData.itemsPath?.trim();
    if (!hasTargets && !hasLegacyPaths) {
      setValidationError('インポート対象を1つ以上指定してください');
      return;
    }

    const cronSchedule = buildCronSchedule();
    if (cronSchedule === null) {
      return;
    }

    const scheduleToSave: CsvImportSchedule = {
      ...formData,
      schedule: cronSchedule
    } as CsvImportSchedule;

    if (scheduleToSave.targets && scheduleToSave.targets.length > 0) {
      scheduleToSave.employeesPath = undefined;
      scheduleToSave.itemsPath = undefined;
    } else {
      scheduleToSave.targets = undefined;
    }

    try {
      const result = await create.mutateAsync(scheduleToSave);
      setSaveWarnings(result.warnings ?? []);
      setShowCreateForm(false);
      resetUiState();
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
    clearScheduleWarnings();

    const hasTargets = formData.targets && formData.targets.length > 0;
    const hasLegacyPaths = formData.employeesPath?.trim() || formData.itemsPath?.trim();
    if (!hasTargets && !hasLegacyPaths) {
      setValidationError('インポート対象を1つ以上指定してください');
      return;
    }

    const cronSchedule = buildCronSchedule();
    if (cronSchedule === null) {
      return;
    }

    const scheduleToSave: Partial<CsvImportSchedule> = {
      ...formData,
      schedule: cronSchedule
    };

    if (scheduleToSave.targets && scheduleToSave.targets.length > 0) {
      scheduleToSave.employeesPath = undefined;
      scheduleToSave.itemsPath = undefined;
    } else if (scheduleToSave.employeesPath || scheduleToSave.itemsPath) {
      scheduleToSave.targets = undefined;
    }

    try {
      const result = await update.mutateAsync({ id, schedule: scheduleToSave });
      setSaveWarnings(result.warnings ?? []);
      setEditingId(null);
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const cancelEdit = () => {
    clearScheduleWarnings();
    setEditingId(null);
    setValidationError(null);
    resetUiState();
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
      if (editingId === id) {
        cancelEdit();
      }
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const startEdit = (schedule: CsvImportSchedule) => {
    clearScheduleWarnings();
    setEditingId(schedule.id);
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
    const parsed = parseCronSchedule(schedule.schedule);
    setScheduleTime(parsed.time);
    setScheduleDaysOfWeek(parsed.daysOfWeek);
    setScheduleMode(parsed.mode);
    setIntervalMinutes(parsed.intervalMinutes ? String(parsed.intervalMinutes) : '10');
    setOffsetMinutes(typeof parsed.offsetMinutes === 'number' ? String(parsed.offsetMinutes) : '0');
    setScheduleEditable(parsed.isEditable);
    setScheduleEditWarning(parsed.isEditable ? null : (parsed.reason || 'このcron形式はUIから編集できません'));
  };

  const handleCancelCreate = () => {
    clearScheduleWarnings();
    setShowCreateForm(false);
    setValidationError(null);
    setFormData({ ...DEFAULT_CSV_IMPORT_FORM_DATA });
    setScheduleTime('02:00');
    setScheduleDaysOfWeek([]);
    setScheduleMode('timeOfDay');
    setIntervalMinutes('10');
    setScheduleEditable(true);
    setScheduleEditWarning(null);
  };

  const openCreateForm = () => {
    if (editingId !== null) {
      cancelEdit();
    }
    clearScheduleWarnings();
    setShowCreateForm(true);
  };

  useEffect(() => {
    if (showCreateForm) {
      clearScheduleWarnings();
      setFormData({ ...DEFAULT_CSV_IMPORT_FORM_DATA });
      setScheduleTime('02:00');
      setScheduleDaysOfWeek([]);
      setScheduleMode('timeOfDay');
      setIntervalMinutes('10');
      setOffsetMinutes('0');
      setScheduleEditable(true);
      setScheduleEditWarning(null);
    }
  }, [showCreateForm]);

  return {
    isLoading,
    refetch,
    schedules,
    displayedScheduleWarnings,
    create,
    update,
    remove,
    editingId,
    showCreateForm,
    validationError,
    formData,
    setFormData,
    scheduleTime,
    setScheduleTime,
    scheduleDaysOfWeek,
    setScheduleDaysOfWeek,
    scheduleMode,
    setScheduleMode,
    intervalMinutes,
    setIntervalMinutes,
    offsetMinutes,
    setOffsetMinutes,
    scheduleEditable,
    scheduleEditWarning,
    patternsByType,
    handleCreate,
    handleUpdate,
    handleDelete,
    startEdit,
    cancelEdit,
    handleCancelCreate,
    openCreateForm
  };
}

export type CsvImportScheduleFormController = ReturnType<typeof useCsvImportScheduleForm>;
