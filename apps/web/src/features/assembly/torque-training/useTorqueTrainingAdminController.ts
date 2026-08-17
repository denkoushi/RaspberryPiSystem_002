import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import {
  createTorqueTrainingProgram,
  deactivateTorqueTrainingProgram,
  excludeTorqueTrainingResult,
  listTorqueTrainingAdminPrograms,
  listTorqueTrainingAdminResults,
  listTorqueWrenchCapabilityGroups,
  listTorqueWrenches,
  reviseTorqueTrainingProgram,
  type TorqueTrainingAdminResultApi,
  type TorqueTrainingProgramApi,
  type TorqueWrenchCapabilityGroupApi,
  type TorqueWrenchProfileApi
} from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';

import {
  EMPTY_TORQUE_TRAINING_PROGRAM_FORM,
  torqueTrainingProgramFormToPayload,
  torqueTrainingProgramFormToRevisionPayload,
  type TorqueTrainingProgramForm
} from './torqueTrainingProgramForm';

export type TorqueTrainingAdminTab = 'programs' | 'results';

export type TorqueTrainingAdminControllerInput = {
  /** The admin dialog being open is the only time admin data is fetched. */
  isOpen: boolean;
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
  setRevisionProgramId: Dispatch<SetStateAction<string>>;
  resultQuery: string;
  setResultQuery: Dispatch<SetStateAction<string>>;
  exclusionReasons: Record<string, string>;
  setExclusionReason: (sessionId: string, reason: string) => void;
  adminBusy: boolean;
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep a stable load callback even if the page creates its callback inline.
  // The latest callback is still used for mutations.
  const onProgramsChangedRef = useRef(onProgramsChanged);
  onProgramsChangedRef.current = onProgramsChanged;

  const notifyProgramsChanged = useCallback(async () => {
    await onProgramsChangedRef.current?.();
  }, []);

  const loadAdminData = useCallback(async () => {
    setAdminBusy(true);
    setError(null);
    try {
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
    } catch (cause) {
      setError(getApiErrorMessage(cause, ADMIN_LOAD_ERROR));
    } finally {
      setAdminBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadAdminData();
  }, [isOpen, loadAdminData]);

  const updateProgramForm = useCallback(
    (key: keyof TorqueTrainingProgramForm, value: string | string[]) => {
      setProgramForm((current) => ({ ...current, [key]: value } as TorqueTrainingProgramForm));
    },
    []
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
          await reviseTorqueTrainingProgram(
            revisionProgramId,
            torqueTrainingProgramFormToRevisionPayload(programForm)
          );
        } else {
          await createTorqueTrainingProgram(torqueTrainingProgramFormToPayload(programForm));
        }

        // Refresh the normal training selector immediately after the write so
        // a newly created/revised active version is usable without reload.
        await notifyProgramsChanged();
        setAdminPrograms(await listTorqueTrainingAdminPrograms());
        setProgramForm(EMPTY_TORQUE_TRAINING_PROGRAM_FORM);
        setRevisionProgramId('');
        setMessage(revision ? '新しい訓練メニュー版を追加しました。' : '訓練メニューを追加しました。');
      } catch (cause) {
        setError(getApiErrorMessage(cause, PROGRAM_SAVE_ERROR));
      } finally {
        setAdminBusy(false);
      }
    },
    [adminBusy, notifyProgramsChanged, programForm, revisionProgramId]
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
        await deactivateTorqueTrainingProgram(programId, normalizedReason);
        await notifyProgramsChanged();
        setAdminPrograms(await listTorqueTrainingAdminPrograms());
        setMessage('訓練メニューを停止しました。');
      } catch (cause) {
        setError(getApiErrorMessage(cause, PROGRAM_DEACTIVATE_ERROR));
      } finally {
        setAdminBusy(false);
      }
    },
    [adminBusy, notifyProgramsChanged]
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
        await excludeTorqueTrainingResult(sessionId, reason);
        setAdminResults(await listTorqueTrainingAdminResults());
        setExclusionReasons((current) => ({ ...current, [sessionId]: '' }));
        setMessage('訓練実績を集計対象外にしました。');
      } catch (cause) {
        setError(getApiErrorMessage(cause, RESULT_EXCLUDE_ERROR));
      } finally {
        setAdminBusy(false);
      }
    },
    [adminBusy, exclusionReasons]
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
    setRevisionProgramId,
    resultQuery,
    setResultQuery,
    exclusionReasons,
    setExclusionReason,
    adminBusy,
    message,
    error,
    submitProgram,
    deactivate,
    excludeResult
  };
}
