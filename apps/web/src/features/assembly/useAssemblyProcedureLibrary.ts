import { useCallback, useEffect, useRef, useState } from 'react';

import { listAssemblyProcedureDocumentSummaries } from '../../api/client';

import type { AssemblyProcedureDocumentSummaryDto } from './types';

const ASSEMBLY_LIBRARY_SEARCH_DEBOUNCE_MS = 400;
const ASSEMBLY_LIBRARY_LIMIT = 200;

type Options = {
  refreshToken?: number;
  enabled?: boolean;
};

export function useAssemblyProcedureLibrary({ refreshToken = 0, enabled = true }: Options = {}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [documents, setDocuments] = useState<AssemblyProcedureDocumentSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, ASSEMBLY_LIBRARY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    void listAssemblyProcedureDocumentSummaries({
      q: debouncedQuery || undefined,
      includeInactive,
      limit: ASSEMBLY_LIBRARY_LIMIT
    })
      .then((list) => {
        if (requestSeqRef.current !== requestSeq) return;
        setDocuments(list);
      })
      .catch((e: unknown) => {
        if (requestSeqRef.current !== requestSeq) return;
        const err = e as { response?: { data?: { message?: string } } };
        setError(err.response?.data?.message ?? '手順書ライブラリの取得に失敗しました。');
        setDocuments([]);
      })
      .finally(() => {
        if (requestSeqRef.current === requestSeq) {
          setLoading(false);
        }
      });
  }, [debouncedQuery, enabled, includeInactive, refreshToken, reloadToken]);

  return {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    includeInactive,
    setIncludeInactive,
    documents,
    loading,
    error,
    reload
  };
}
