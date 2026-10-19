import { isAxiosError } from 'axios';

import type { FeedbackKind } from './planningBoardPageModel';
import type { PlanningBoardAllocation } from './types';
import type { usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';
import type { useKioskGrindingPlanningBoardProgressive, useUpdateKioskGrindingPlanningBoardSeibanOrder } from '../../../api/hooks';
import type { GrindingPlanningBoardResponse } from '@raspi-system/shared-types';
import type { Dispatch, SetStateAction } from 'react';

type Options = {
  data: GrindingPlanningBoardResponse | undefined;
  scopeReady: boolean;
  writeBlocked: boolean;
  allocation: PlanningBoardAllocation;
  setOrderRegistrationError: Dispatch<SetStateAction<string | null>>;
  enqueueWrite: ReturnType<typeof usePlanningBoardWriteQueue>['enqueue'];
  registeredFseibans: string[];
  updateOrder: ReturnType<typeof useUpdateKioskGrindingPlanningBoardSeibanOrder>;
  setOrderConflict: Dispatch<SetStateAction<boolean>>;
  notify: (message: string, kind: FeedbackKind) => void;
  boardQuery: ReturnType<typeof useKioskGrindingPlanningBoardProgressive>;
  setRankConflict: Dispatch<SetStateAction<boolean>>;
  acceptRefreshedState: () => void;
  activeFseibans: ReadonlySet<string>;
  openFseibans: ReadonlySet<string>;
  setActiveFseibans: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setOpenFseibans: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setDueDetailTargetFseiban: Dispatch<SetStateAction<string | null>>;
  setDueDetailFseiban: Dispatch<SetStateAction<string | null>>;
};

export function createPlanningBoardSeibanActions({
  data, scopeReady, writeBlocked, allocation, setOrderRegistrationError, enqueueWrite,
  registeredFseibans, updateOrder, setOrderConflict, notify, boardQuery, setRankConflict,
  acceptRefreshedState, activeFseibans, openFseibans, setActiveFseibans, setOpenFseibans,
  setDueDetailTargetFseiban, setDueDetailFseiban
}: Options) {
  const persistOrder = (nextOrder: string[], onAccepted?: () => void, onRejected?: () => void): Promise<boolean> => {
    if (!data || !scopeReady || writeBlocked || allocation === 'original') return Promise.resolve(false);
    if (nextOrder.length > 50) {
      setOrderRegistrationError('登録上限50件を超えるため保存できません。選択を減らしてください。');
      return Promise.resolve(false);
    }
    setOrderRegistrationError(null);
    return new Promise((resolve) => {
      const accepted = enqueueWrite({ label: '製番順', itemIds: [], seibans: [...new Set([...registeredFseibans, ...nextOrder])], order: true,
        apply: (display) => ({ ...display, order: nextOrder }),
        save: async (context) => {
          const result = await updateOrder.mutateAsync({ sourceRevision: context.sourceRevision, fseibans: nextOrder });
          return { sourceRevision: result.sourceRevision, order: result.seibanOrder };
        },
        onSaved: () => resolve(true),
        onFailed: (error) => {
          onRejected?.();
          resolve(false);
          const conflict = isAxiosError(error) && error.response?.status === 409;
          setOrderConflict(conflict);
          setOrderRegistrationError(conflict ? '製番順が他端末で更新されています。最新状態を取得してから再登録してください。' : '製番登録を保存できませんでした。通信状態と入力値を確認してください。');
        }
      });
      if (accepted) onAccepted?.(); else resolve(false);
    });
  };

  const refreshAfterOrderConflict = async () => {
    notify('最新状態を取得しています…', 'processing');
    const result = await boardQuery.refetch();
    if (result.isError || !result.data) { notify('最新状態を取得できませんでした。再試行してください。', 'error'); return; }
    setOrderRegistrationError(null); setOrderConflict(false); setRankConflict(false);
    acceptRefreshedState();
    notify('最新状態を取得しました。', 'success');
  };
  const removeSeiban = (fseiban: string) => {
    const wasActive = activeFseibans.has(fseiban);
    const wasOpen = openFseibans.has(fseiban);
    void persistOrder(registeredFseibans.filter((value) => value !== fseiban), () => {
      setActiveFseibans((current) => new Set([...current].filter((value) => value !== fseiban)));
      setOpenFseibans((current) => new Set([...current].filter((value) => value !== fseiban)));
      setDueDetailTargetFseiban((current) => current === fseiban ? null : current);
      setDueDetailFseiban((current) => current === fseiban ? null : current);
    }, () => {
      if (wasActive) setActiveFseibans((current) => new Set([...current, fseiban]));
      if (wasOpen) setOpenFseibans((current) => new Set([...current, fseiban]));
    });
  };
  const addSeibans = async (fseibans: readonly string[]): Promise<boolean> => {
    const additions = [...new Set(fseibans.map((value) => value.trim()).filter(Boolean))].filter((value) => !registeredFseibans.includes(value));
    if (!additions.length) return true;
    return persistOrder([...additions, ...registeredFseibans], () => {
      setActiveFseibans((current) => new Set([...additions, ...current]));
      setOpenFseibans((current) => new Set([...additions, ...current]));
    }, () => {
      setActiveFseibans((current) => new Set([...current].filter((value) => !additions.includes(value))));
      setOpenFseibans((current) => new Set([...current].filter((value) => !additions.includes(value))));
    });
  };
  const addSeiban = async (fseiban: string): Promise<boolean> => {
    if (!fseiban.trim() || registeredFseibans.includes(fseiban.trim())) return false;
    return addSeibans([fseiban]);
  };
  const moveSeiban = (fseiban: string, direction: 'up' | 'down') => {
    const index = registeredFseibans.indexOf(fseiban); const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= registeredFseibans.length) return;
    const next = [...registeredFseibans]; [next[index], next[target]] = [next[target], next[index]];
    void persistOrder(next);
  };

  return { refreshAfterOrderConflict, removeSeiban, addSeibans, addSeiban, moveSeiban };
}
