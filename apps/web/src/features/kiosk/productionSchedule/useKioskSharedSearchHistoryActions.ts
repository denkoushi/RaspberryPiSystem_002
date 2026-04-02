import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef } from 'react';

import {
  useKioskProductionScheduleSearchState,
  useUpdateKioskProductionScheduleSearchState
} from '../../../api/hooks';

import { normalizeHistoryList } from './useProductionScheduleQueryParams';

const SEARCH_STATE_QUERY_KEY = ['kiosk-production-schedule-search-state'] as const;

export type KioskSharedSearchHistoryOperation = { type: 'add' | 'remove'; value: string };

/**
 * 生産スケジュールの共有 search-state（履歴のみサーバ永続）の読み取りと書き込み。
 * 手動順番ページの {@link useSharedSearchHistory} と同じ If-Match / 409 収束を、URL 状態なしで使う。
 */
export function useKioskSharedSearchHistoryActions(options?: { pauseRefetch?: boolean }) {
  const queryClient = useQueryClient();
  const searchStateQuery = useKioskProductionScheduleSearchState({ pauseRefetch: options?.pauseRefetch });
  const updateMutation = useUpdateKioskProductionScheduleSearchState();
  const etagRef = useRef<string | null>(null);

  useEffect(() => {
    const etag = searchStateQuery.data?.etag ?? null;
    if (etag) {
      etagRef.current = etag;
    }
  }, [searchStateQuery.data?.etag]);

  const sharedHistory = normalizeHistoryList(searchStateQuery.data?.state?.history ?? []);

  const writeHistory = useCallback(
    async (nextHistory: string[], operation: KioskSharedSearchHistoryOperation, attempt = 0): Promise<void> => {
      if (!etagRef.current) {
        await searchStateQuery.refetch();
      }
      const ifMatch = etagRef.current;
      if (!ifMatch) {
        return;
      }

      try {
        const result = await updateMutation.mutateAsync({
          state: { history: nextHistory },
          ifMatch
        });
        if (result.etag) {
          etagRef.current = result.etag;
        }
        await queryClient.invalidateQueries({ queryKey: [...SEARCH_STATE_QUERY_KEY] });
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 409 && attempt < 2) {
          const details = (error.response?.data?.details ?? {}) as {
            state?: { history?: string[] };
            updatedAt?: string | null;
            etag?: string | null;
          };
          const latestHistory = normalizeHistoryList(details.state?.history ?? []);
          let rebasedHistory = latestHistory;
          if (operation.type === 'add') {
            rebasedHistory = normalizeHistoryList([operation.value, ...latestHistory]);
          } else {
            rebasedHistory = latestHistory.filter((item) => item !== operation.value);
          }
          if (details.etag) {
            etagRef.current = details.etag;
          }
          await writeHistory(rebasedHistory, operation, attempt + 1);
          return;
        }
        throw error;
      }
    },
    [queryClient, searchStateQuery, updateMutation]
  );

  const addSeibanToHistory = useCallback(
    async (fseiban: string) => {
      const trimmed = fseiban.trim();
      if (!trimmed.length) {
        return;
      }
      const { data: fresh } = await searchStateQuery.refetch();
      if (fresh?.etag) {
        etagRef.current = fresh.etag;
      }
      const current = normalizeHistoryList(fresh?.state?.history ?? []);
      const next = normalizeHistoryList([trimmed, ...current]);
      await writeHistory(next, { type: 'add', value: trimmed }, 0);
    },
    [searchStateQuery, writeHistory]
  );

  const removeSeibanFromHistory = useCallback(
    async (fseiban: string) => {
      const { data: fresh } = await searchStateQuery.refetch();
      if (fresh?.etag) {
        etagRef.current = fresh.etag;
      }
      const current = normalizeHistoryList(fresh?.state?.history ?? []);
      const next = current.filter((item) => item !== fseiban);
      await writeHistory(next, { type: 'remove', value: fseiban }, 0);
    },
    [searchStateQuery, writeHistory]
  );

  return {
    sharedHistory,
    searchStateQuery,
    historyWriting: updateMutation.isPending,
    addSeibanToHistory,
    removeSeibanFromHistory
  };
}
