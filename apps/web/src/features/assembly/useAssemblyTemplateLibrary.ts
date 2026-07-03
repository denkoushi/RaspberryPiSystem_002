import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listAssemblyTemplateSummaries } from '../../api/client';

import type { AssemblyTemplateSummaryDto } from './types';

const ASSEMBLY_LIBRARY_SEARCH_DEBOUNCE_MS = 400;
const ASSEMBLY_TEMPLATE_LIBRARY_LIMIT = 200;

type TemplateLibraryFilters = {
  q: string;
  modelCode: string;
  procedurePattern: string;
  procedureDocumentName: string;
  includeInactive: boolean;
};

const DEFAULT_FILTERS: TemplateLibraryFilters = {
  q: '',
  modelCode: '',
  procedurePattern: '',
  procedureDocumentName: '',
  includeInactive: false
};

function hasActiveTemplateFilters(filters: TemplateLibraryFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.modelCode.trim() !== '' ||
    filters.procedurePattern.trim() !== '' ||
    filters.procedureDocumentName.trim() !== '' ||
    filters.includeInactive
  );
}

type Options = {
  refreshToken?: number;
  enabled?: boolean;
  procedureDocumentId?: string;
};

export function useAssemblyTemplateLibrary({ refreshToken = 0, enabled = true, procedureDocumentId }: Options = {}) {
  const [filters, setFilters] = useState<TemplateLibraryFilters>(DEFAULT_FILTERS);
  const [debouncedFilters, setDebouncedFilters] = useState({
    q: '',
    modelCode: '',
    procedurePattern: '',
    procedureDocumentName: ''
  });
  const [templates, setTemplates] = useState<AssemblyTemplateSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const next = {
      q: filters.q.trim(),
      modelCode: filters.modelCode.trim(),
      procedurePattern: filters.procedurePattern.trim(),
      procedureDocumentName: filters.procedureDocumentName.trim()
    };
    if (
      debouncedFilters.q === next.q &&
      debouncedFilters.modelCode === next.modelCode &&
      debouncedFilters.procedurePattern === next.procedurePattern &&
      debouncedFilters.procedureDocumentName === next.procedureDocumentName
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDebouncedFilters(next);
    }, ASSEMBLY_LIBRARY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    debouncedFilters.modelCode,
    debouncedFilters.procedureDocumentName,
    debouncedFilters.procedurePattern,
    debouncedFilters.q,
    filters.modelCode,
    filters.procedureDocumentName,
    filters.procedurePattern,
    filters.q
  ]);

  useEffect(() => {
    if (!enabled) return;
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    void listAssemblyTemplateSummaries({
      q: debouncedFilters.q || undefined,
      modelCode: debouncedFilters.modelCode || undefined,
      procedurePattern: debouncedFilters.procedurePattern || undefined,
      procedureDocumentName: debouncedFilters.procedureDocumentName || undefined,
      procedureDocumentId,
      includeInactive: filters.includeInactive,
      limit: ASSEMBLY_TEMPLATE_LIBRARY_LIMIT
    })
      .then((list) => {
        if (requestSeqRef.current !== requestSeq) return;
        setTemplates(list);
      })
      .catch((e: unknown) => {
        if (requestSeqRef.current !== requestSeq) return;
        const err = e as { response?: { data?: { message?: string } } };
        setError(err.response?.data?.message ?? '組立テンプレート一覧の取得に失敗しました。');
        setTemplates([]);
      })
      .finally(() => {
        if (requestSeqRef.current === requestSeq) {
          setLoading(false);
        }
      });
  }, [
    debouncedFilters.modelCode,
    debouncedFilters.procedureDocumentName,
    debouncedFilters.procedurePattern,
    debouncedFilters.q,
    enabled,
    filters.includeInactive,
    procedureDocumentId,
    refreshToken,
    reloadToken
  ]);

  const updateFilter = useCallback(<K extends keyof TemplateLibraryFilters>(
    key: K,
    value: TemplateLibraryFilters[K]
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setDebouncedFilters({
      q: DEFAULT_FILTERS.q,
      modelCode: DEFAULT_FILTERS.modelCode,
      procedurePattern: DEFAULT_FILTERS.procedurePattern,
      procedureDocumentName: DEFAULT_FILTERS.procedureDocumentName
    });
  }, []);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const hasActiveFilters = useMemo(() => hasActiveTemplateFilters(filters), [filters]);

  return {
    filters,
    templates,
    loading,
    error,
    hasActiveFilters,
    setQ: (value: string) => updateFilter('q', value),
    setModelCode: (value: string) => updateFilter('modelCode', value),
    setProcedurePattern: (value: string) => updateFilter('procedurePattern', value),
    setProcedureDocumentName: (value: string) => updateFilter('procedureDocumentName', value),
    setIncludeInactive: (value: boolean) => updateFilter('includeInactive', value),
    resetFilters,
    reload
  };
}
