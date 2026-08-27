import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import {
  createTorqueTrainingSettingsProgram,
  createTorqueTrainingProgram,
  deactivateTorqueTrainingSettingsProgram,
  deactivateTorqueTrainingProgram,
  excludeTorqueTrainingSettingsResult,
  excludeTorqueTrainingResult,
  getTorqueTrainingSettingsSnapshot,
  listTorqueTrainingAdminPrograms,
  listTorqueTrainingAdminResults,
  listTorqueWrenchCapabilityGroups,
  listTorqueWrenches,
  reviseTorqueTrainingSettingsProgram,
  reviseTorqueTrainingProgram,
  type TorqueTrainingAdminResultApi,
  type TorqueTrainingProgramApi,
  type TorqueTrainingSettingsSnapshotApi,
  type TorqueWrenchCapabilityGroupApi,
  type TorqueWrenchProfileApi
} from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';

import {
  EMPTY_TORQUE_TRAINING_PROGRAM_FORM,
  torqueTrainingProgramFormToPayload,
  torqueTrainingProgramFormToRevisionPayload,
  torqueTrainingProgramVersionToForm,
  type TorqueTrainingProgramForm
} from './torqueTrainingProgramForm';

export type TorqueTrainingAdminTab = 'programs' | 'results';

export type TorqueTrainingAdminControllerInput = {
  /** The admin dialog being open is the only time admin data is fetched. */
  isOpen: boolean;
  /**
   * Kiosk settings use the shared operation password instead of an ADMIN
   * bearer token. The default keeps the controller compatible with the
   * existing admin-console dialog tests and callers.
   */
  accessMode?: 'admin' | 'kiosk';
  /** Refreshes the normal training-menu list after a program mutation. */
  onProgramsChanged?: () => void | Promise<void>;
};

export type TorqueTrainingAdminController = {
  adminPrograms: TorqueTrainingProgramApi[];
  adminResults: TorqueTrainingAdminResultApi[];
  filteredAdminResults: TorqueTrainingAdminResultApi[];
  capabilityGroups: TorqueWrenchCapabilityGroupApi[];
  wrenchProfiles: TorqueWrenchProfileApi[];
  adminTab: TorqueTrainingAdminTab;
  setAdminTab: Dispatch<SetStateAction<TorqueTrainingAdminTab>>;
  programForm: TorqueTrainingProgramForm;
  updateProgramForm: (key: keyof TorqueTrainingProgramForm, value: string | string[]) => void;
  revisionProgramId: string;
  selectRevisionProgram: (programId: string) => void;
  resultQuery: string;
  setResultQuery: Dispatch<SetStateAction<string>>;
  exclusionReasons: Record<string, string>;
  setExclusionReason: (sessionId: string, reason: string) => void;
  adminBusy: boolean;
  /** True after the kiosk operation password has successfully loaded a snapshot. */
  settingsAuthenticated: boolean;
  /** Authenticates and loads the kiosk settings snapshot. */
  authenticateSettingsAccessPassword: (accessPassword: string) => Promise<boolean>;
  /** Clears the in-memory kiosk password and all settings data. */
  clearSettingsAccess: () => void;
  /** Notice and error are rendered by the admin dialog, not the page shell. */
  message: string | null;
  error: string | null;
  submitProgram: (revision: boolean) => Promise<void>;
  deactivate: (programId: string, reason: string) => Promise<void>;
  excludeResult: (sessionId: string) => Promise<void>;
};

const ADMIN_LOAD_ERROR = '管理情報を読み込めませんでした。';
const PROGRAM_SAVE_ERROR = '訓練メニューを保存できませんでした。';
const PROGRAM_DEACTIVATE_ERROR = '訓練メニューを停止できませんでした。';
const RESULT_EXCLUDE_ERROR = '実績を集計対象外にできませんでした。';

/**
 * Owns all I/O and state transitions for the torque-training admin dialog.
 * The dialog remains a view of this state; it does not import API clients.
 */
export function useTorqueTrainingAdminController({
  isOpen,
  accessMode = 'admin',
  onProgramsChanged
}: TorqueTrainingAdminControllerInput): TorqueTrainingAdminController {
  const [adminPrograms, setAdminPrograms] = useState<TorqueTrainingProgramApi[]>([]);
  const [adminResults, setAdminResults] = useState<TorqueTrainingAdminResultApi[]>([]);
  const [capabilityGroups, setCapabilityGroups] = useState<TorqueWrenchCapabilityGroupApi[]>([]);
  const [wrenchProfiles, setWrenchProfiles] = useState<TorqueWrenchProfileApi[]>([]);
  const [adminTab, setAdminTab] = useState<TorqueTrainingAdminTab>('programs');
  const [programForm, setProgramForm] = useState<TorqueTrainingProgramForm>(
    EMPTY_TORQUE_TRAINING_PROGRAM_FORM
  );
  const [revisionProgramId, setRevisionProgramId] = useState('');
  const [resultQuery, setResultQuery] = useState('');
  const [exclusionReasons, setExclusionReasons] = useState<Record<string, string>>({});
  const [adminBusy, setAdminBusy] = useState(false);
  const [settingsAccessPassword, setSettingsAccessPassword] = useState<string | null>(null);
  const [settingsAuthenticated, setSettingsAuthenticated] = useState(false);
  const [settingsSnapshotLoaded, setSettingsSnapshotLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep a stable load callback even if the page creates its callback inline.
  // The latest callback is still used for mutations.
  const onProgramsChangedRef = useRef(onProgramsChanged);
  onProgramsChangedRef.current = onProgramsChanged;

  const notifyProgramsChanged = useCallback(async () => {
    await onProgramsChangedRef.current?.();
  }, []);

  const applySettingsSnapshot = useCallback((snapshot: TorqueTrainingSettingsSnapshotApi) => {
    setAdminPrograms(snapshot.programs);
    setAdminResults(snapshot.results);
    setCapabilityGroups(snapshot.capabilityGroups);
    setWrenchProfiles(snapshot.wrenchProfiles);
    setSettingsSnapshotLoaded(true);
  }, []);

  const loadAdminData = useCallback(async (accessPassword?: string): Promise<boolean> => {
    setAdminBusy(true);
    setError(null);
    try {
      if (accessMode === 'kiosk') {
        if (!accessPassword) {
          throw new Error('訓練設定の認証が必要です。');
        }
        applySettingsSnapshot(await getTorqueTrainingSettingsSnapshot(accessPassword));
        return true;
      }
      const [nextPrograms, nextResults, groups, profiles] = await Promise.all([
        listTorqueTrainingAdminPrograms(),
        listTorqueTrainingAdminResults(),
        listTorqueWrenchCapabilityGroups(true),
        listTorqueWrenches(true)
      ]);
      setAdminPrograms(nextPrograms);
      setAdminResults(nextResults);
      setCapabilityGroups(groups);
      setWrenchProfiles(profiles);
      return true;
    } catch (cause) {
      setError(getApiErrorMessage(cause, ADMIN_LOAD_ERROR));
      return false;
    } finally {
      setAdminBusy(false);
    }
  }, [accessMode, applySettingsSnapshot]);

  useEffect(() => {
    if (!isOpen) return;
    if (accessMode === 'kiosk') {
      // Authentication loads the first snapshot before the dialog is opened.
      // This guard also protects against a stale dialog render accidentally
      // issuing a password-less request.
      if (!settingsAuthenticated || !settingsAccessPassword || settingsSnapshotLoaded) return;
      void loadAdminData(settingsAccessPassword);
      return;
    }
    void loadAdminData();
  }, [accessMode, isOpen, loadAdminData, settingsAccessPassword, settingsAuthenticated, settingsSnapshotLoaded]);

  const authenticateSettingsAccessPassword = useCallback(async (accessPassword: string): Promise<boolean> => {
    if (accessMode !== 'kiosk') return false;
    const normalizedPassword = accessPassword.trim();
    if (!normalizedPassword) {
      setError('操作時パスワードを入力してください。');
      return false;
    }
    const loaded = await loadAdminData(normalizedPassword);
    if (!loaded) return false;
    // The password is intentionally held only in this hook's React state for
    // subsequent server-side revalidation. It is never written to storage.
    setSettingsAccessPassword(normalizedPassword);
    setSettingsAuthenticated(true);
    return true;
  }, [accessMode, loadAdminData]);

  const clearSettingsAccess = useCallback(() => {
    setSettingsAccessPassword(null);
    setSettingsAuthenticated(false);
    setSettingsSnapshotLoaded(false);
    setAdminPrograms([]);
    setAdminResults([]);
    setCapabilityGroups([]);
    setWrenchProfiles([]);
    setProgramForm(EMPTY_TORQUE_TRAINING_PROGRAM_FORM);
    setRevisionProgramId('');
    setResultQuery('');
    setExclusionReasons({});
    setMessage(null);
    setError(null);
  }, []);

  const refreshAdminDataAfterMutation = useCallback(async () => {
    if (accessMode === 'kiosk') {
      if (!settingsAccessPassword) throw new Error('訓練設定の認証が必要です。');
      applySettingsSnapshot(await getTorqueTrainingSettingsSnapshot(settingsAccessPassword));
      return;
    }
    setAdminPrograms(await listTorqueTrainingAdminPrograms());
  }, [accessMode, applySettingsSnapshot, settingsAccessPassword]);

  const updateProgramForm = useCallback(
    (key: keyof TorqueTrainingProgramForm, value: string | string[]) => {
      setProgramForm((current) => ({ ...current, [key]: value } as TorqueTrainingProgramForm));
    },
    []
  );

  const selectRevisionProgram = useCallback(
    (programId: string) => {
      if (!programId) {
        setRevisionProgramId('');
        setProgramForm(EMPTY_TORQUE_TRAINING_PROGRAM_FORM);
        return;
      }

      const program = adminPrograms.find((candidate) => candidate.id === programId);
      if (!program?.isActive) {
        setRevisionProgramId('');
        setProgramForm(EMPTY_TORQUE_TRAINING_PROGRAM_FORM);
        return;
      }
      const currentVersion = program?.versions.find(
        (version) => version.version === program.currentVersion
      );
      const latestVersion =
        currentVersion ??
        program?.versions.reduce<TorqueTrainingProgramApi['versions'][number] | undefined>(
          (latest, version) => (!latest || version.version > latest.version ? version : latest),
          undefined
        );

      if (!latestVersion) {
        setRevisionProgramId('');
        setProgramForm(EMPTY_TORQUE_TRAINING_PROGRAM_FORM);
        return;
      }

      setRevisionProgramId(programId);
      setProgramForm(torqueTrainingProgramVersionToForm(program.code, latestVersion));
    },
    [adminPrograms]
  );

  const setExclusionReason = useCallback((sessionId: string, reason: string) => {
    setExclusionReasons((current) => ({ ...current, [sessionId]: reason }));
  }, []);

  const filteredAdminResults = useMemo(() => {
    const normalizedQuery = resultQuery.trim().toLowerCase();
    if (!normalizedQuery) return adminResults;
    return adminResults.filter((result) =>
      `${result.employeeName} ${result.employeeCode} ${result.programCode}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [adminResults, resultQuery]);

  const submitProgram = useCallback(
    async (revision: boolean) => {
      if (adminBusy) return;
      if (revision && !revisionProgramId) {
        setError('版を追加するメニューを選択してください。');
        return;
      }

      setAdminBusy(true);
      setError(null);
      setMessage(null);
      try {
        if (revision) {
          // revisionProgramId is checked above; keeping this guard also makes
          // the API call safe if the function is invoked from a stale view.
          if (!revisionProgramId) throw new Error('版を追加するメニューを選択してください。');
          const revisionPayload = torqueTrainingProgramFormToRevisionPayload(programForm);
          if (accessMode === 'kiosk') {
            if (!settingsAccessPassword) throw new Error('訓練設定の認証が必要です。');
            await reviseTorqueTrainingSettingsProgram(revisionProgramId, settingsAccessPassword, revisionPayload);
          } else {
            await reviseTorqueTrainingProgram(revisionProgramId, revisionPayload);
          }
        } else {
          const programPayload = torqueTrainingProgramFormToPayload(programForm);
          if (accessMode === 'kiosk') {
            if (!settingsAccessPassword) throw new Error('訓練設定の認証が必要です。');
            await createTorqueTrainingSettingsProgram(settingsAccessPassword, programPayload);
          } else {
            await createTorqueTrainingProgram(programPayload);
          }
        }

        // Refresh the normal training selector immediately after the write so
        // a newly created/revised active version is usable without reload.
        await notifyProgramsChanged();
        await refreshAdminDataAfterMutation();
        setProgramForm(EMPTY_TORQUE_TRAINING_PROGRAM_FORM);
        setRevisionProgramId('');
        setMessage(revision ? '新しい訓練メニュー版を追加しました。' : '訓練メニューを追加しました。');
      } catch (cause) {
        setError(getApiErrorMessage(cause, PROGRAM_SAVE_ERROR));
      } finally {
        setAdminBusy(false);
      }
    },
    [accessMode, adminBusy, notifyProgramsChanged, programForm, refreshAdminDataAfterMutation, revisionProgramId, settingsAccessPassword]
  );

  const deactivate = useCallback(
    async (programId: string, reason: string) => {
      const normalizedReason = reason.trim();
      if (!normalizedReason) {
        setError('停止理由を入力してください。');
        return;
      }
      if (adminBusy) return;

      setAdminBusy(true);
      setError(null);
      setMessage(null);
      try {
        if (accessMode === 'kiosk') {
          if (!settingsAccessPassword) throw new Error('訓練設定の認証が必要です。');
          await deactivateTorqueTrainingSettingsProgram(programId, settingsAccessPassword, normalizedReason);
        } else {
          await deactivateTorqueTrainingProgram(programId, normalizedReason);
        }
        await notifyProgramsChanged();
        await refreshAdminDataAfterMutation();
        setMessage('訓練メニューを停止しました。');
      } catch (cause) {
        setError(getApiErrorMessage(cause, PROGRAM_DEACTIVATE_ERROR));
      } finally {
        setAdminBusy(false);
      }
    },
    [accessMode, adminBusy, notifyProgramsChanged, refreshAdminDataAfterMutation, settingsAccessPassword]
  );

  const excludeResult = useCallback(
    async (sessionId: string) => {
      const reason = exclusionReasons[sessionId]?.trim() ?? '';
      if (!reason) {
        setError('除外理由を入力してください。');
        return;
      }
      if (adminBusy) return;

      setAdminBusy(true);
      setError(null);
      setMessage(null);
      try {
        if (accessMode === 'kiosk') {
          if (!settingsAccessPassword) throw new Error('訓練設定の認証が必要です。');
          await excludeTorqueTrainingSettingsResult(sessionId, settingsAccessPassword, reason);
        } else {
          await excludeTorqueTrainingResult(sessionId, reason);
        }
        if (accessMode === 'kiosk') {
          await refreshAdminDataAfterMutation();
        } else {
          setAdminResults(await listTorqueTrainingAdminResults());
        }
        setExclusionReasons((current) => ({ ...current, [sessionId]: '' }));
        setMessage('訓練実績を集計対象外にしました。');
      } catch (cause) {
        setError(getApiErrorMessage(cause, RESULT_EXCLUDE_ERROR));
      } finally {
        setAdminBusy(false);
      }
    },
    [accessMode, adminBusy, exclusionReasons, refreshAdminDataAfterMutation, settingsAccessPassword]
  );

  return {
    adminPrograms,
    adminResults,
    filteredAdminResults,
    capabilityGroups,
    wrenchProfiles,
    adminTab,
    setAdminTab,
    programForm,
    updateProgramForm,
    revisionProgramId,
    selectRevisionProgram,
    resultQuery,
    setResultQuery,
    exclusionReasons,
    setExclusionReason,
    adminBusy,
    settingsAuthenticated,
    authenticateSettingsAccessPassword,
    clearSettingsAccess,
    message,
    error,
    submitProgram,
    deactivate,
    excludeResult
  };
}
