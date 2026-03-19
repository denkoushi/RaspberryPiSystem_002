import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef } from 'react';

import { normalizeHistoryList } from './useProductionScheduleQueryParams';

export type SearchStateOperation = { type: 'add' | 'remove'; value: string };

type SearchStateQueryLike = {
  data?: {
    state?: { history?: string[] } | null;
    updatedAt?: string | null;
    etag?: string | null;
  };
  refetch: () => Promise<unknown>;
};

type SearchStateMutationLike = {
  mutateAsync: (payload: { state: { history: string[] }; ifMatch: string }) => Promise<{
    updatedAt: string;
    etag?: string | null;
  }>;
};

type Params = {
  normalizedHistory: string[];
  setHistory: (value: string[]) => void;
  setHiddenHistory: (updater: (prev: string[]) => string[]) => void;
  searchStateQuery: SearchStateQueryLike;
  searchStateMutation: SearchStateMutationLike;
};

export const useSharedSearchHistory = ({
  normalizedHistory,
  setHistory,
  setHiddenHistory,
  searchStateQuery,
  searchStateMutation
}: Params) => {
  const searchStateUpdatedAtRef = useRef<string | null>(null);
  const searchStateEtagRef = useRef<string | null>(null);

  const updateSharedSearchState = useCallback(
    async (nextHistory: string[], operation: SearchStateOperation, attempt = 0) => {
      if (!searchStateEtagRef.current) {
        await searchStateQuery.refetch();
      }
      const ifMatch = searchStateEtagRef.current;
      if (!ifMatch) {
        return;
      }
      try {
        const result = await searchStateMutation.mutateAsync({
          state: { history: nextHistory },
          ifMatch
        });
        searchStateUpdatedAtRef.current = result.updatedAt;
        if (result.etag) {
          searchStateEtagRef.current = result.etag;
        }
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 409 && attempt < 2) {
          const details = (error.response?.data?.details ?? {}) as {
            state?: { history?: string[] };
            updatedAt?: string | null;
            etag?: string | null;
          };
          const latestHistory = normalizeHistoryList(details.state?.history ?? []);
          let rebasedHistory = latestHistory;
          switch (operation.type) {
            case 'add':
              rebasedHistory = normalizeHistoryList([operation.value, ...latestHistory]);
              break;
            case 'remove':
              rebasedHistory = latestHistory.filter((item) => item !== operation.value);
              break;
          }
          setHistory(rebasedHistory);
          setHiddenHistory((prev) => prev.filter((item) => item !== operation.value));
          if (details.updatedAt) {
            searchStateUpdatedAtRef.current = details.updatedAt;
          }
          if (details.etag) {
            searchStateEtagRef.current = details.etag;
          }
          await updateSharedSearchState(rebasedHistory, operation, attempt + 1);
          return;
        }
        throw error;
      }
    },
    [searchStateMutation, searchStateQuery, setHiddenHistory, setHistory]
  );

  useEffect(() => {
    const updatedAt = searchStateQuery.data?.updatedAt ?? null;
    const incomingState = searchStateQuery.data?.state ?? null;
    const incomingEtag = searchStateQuery.data?.etag ?? null;
    if (incomingEtag) {
      searchStateEtagRef.current = incomingEtag;
    }
    if (!updatedAt || !incomingState) return;

    const lastUpdatedAt = searchStateUpdatedAtRef.current;
    if (lastUpdatedAt && new Date(updatedAt).getTime() <= new Date(lastUpdatedAt).getTime()) {
      return;
    }

    const incomingHistory = normalizeHistoryList(incomingState.history ?? []);
    const isSameHistory =
      incomingHistory.length === normalizedHistory.length &&
      incomingHistory.every((item, idx) => item === normalizedHistory[idx]);

    if (!isSameHistory) {
      setHistory(incomingHistory);
      setHiddenHistory(() => []);
    }

    searchStateUpdatedAtRef.current = updatedAt;
  }, [
    normalizedHistory,
    searchStateQuery.data?.etag,
    searchStateQuery.data?.state,
    searchStateQuery.data?.updatedAt,
    setHiddenHistory,
    setHistory
  ]);

  return { updateSharedSearchState };
};
