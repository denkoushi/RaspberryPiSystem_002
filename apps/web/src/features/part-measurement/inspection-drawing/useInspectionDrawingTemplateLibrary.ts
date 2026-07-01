import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listKioskInspectionDrawingTemplates } from '../../../api/client';

import { INSPECTION_DRAWING_VISUAL_SEARCH_DEBOUNCE_MS } from './inspectionDrawingVisualLibraryConstants';

import type { InspectionDrawingLibraryProcessFilter } from './InspectionDrawingLibraryFilterBar';
import type { KioskInspectionDrawingTemplateSummaryDto } from '../types';

const DEFAULT_PROCESS_FILTER: InspectionDrawingLibraryProcessFilter = 'all';

type TemplateLibraryFilters = {
  fhincd: string;
  visualName: string;
  resourceCd: string;
  processFilter: InspectionDrawingLibraryProcessFilter;
  includeInactive: boolean;
};

const DEFAULT_FILTERS: TemplateLibraryFilters = {
  fhincd: '',
  visualName: '',
  resourceCd: '',
  processFilter: DEFAULT_PROCESS_FILTER,
  includeInactive: false
};

function hasActiveTemplateFilters(filters: TemplateLibraryFilters): boolean {
  return (
    filters.fhincd.trim() !== '' ||
    filters.visualName.trim() !== '' ||
    filters.resourceCd !== '' ||
    filters.processFilter !== DEFAULT_PROCESS_FILTER ||
    filters.includeInactive
  );
}

export function useInspectionDrawingTemplateLibrary() {
  const [filters, setFilters] = useState<TemplateLibraryFilters>(DEFAULT_FILTERS);
  const [debouncedTextFilters, setDebouncedTextFilters] = useState({
    fhincd: DEFAULT_FILTERS.fhincd,
    visualName: DEFAULT_FILTERS.visualName
  });
  const [templates, setTemplates] = useState<KioskInspectionDrawingTemplateSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const nextFhincd = filters.fhincd.trim();
    const nextVisualName = filters.visualName.trim();
    if (debouncedTextFilters.fhincd === nextFhincd && debouncedTextFilters.visualName === nextVisualName) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDebouncedTextFilters({
        fhincd: nextFhincd,
        visualName: nextVisualName
      });
    }, INSPECTION_DRAWING_VISUAL_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [debouncedTextFilters.fhincd, debouncedTextFilters.visualName, filters.fhincd, filters.visualName]);

  useEffect(() => {
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    void listKioskInspectionDrawingTemplates({
      includeInactive: filters.includeInactive,
      fhincd: debouncedTextFilters.fhincd || undefined,
      visualName: debouncedTextFilters.visualName || undefined,
      processGroup: filters.processFilter === 'all' ? undefined : filters.processFilter,
      resourceCd: filters.resourceCd || undefined
    })
      .then((list) => {
        if (requestSeqRef.current !== requestSeq) return;
        setTemplates(list);
      })
      .catch((e: unknown) => {
        if (requestSeqRef.current !== requestSeq) return;
        const err = e as { response?: { data?: { message?: string } } };
        setError(err.response?.data?.message ?? '検査図面テンプレートの取得に失敗しました。');
        setTemplates([]);
      })
      .finally(() => {
        if (requestSeqRef.current === requestSeq) {
          setLoading(false);
        }
      });
  }, [
    debouncedTextFilters.fhincd,
    debouncedTextFilters.visualName,
    filters.includeInactive,
    filters.processFilter,
    filters.resourceCd,
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
    setDebouncedTextFilters({
      fhincd: DEFAULT_FILTERS.fhincd,
      visualName: DEFAULT_FILTERS.visualName
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
    setFhincd: (value: string) => updateFilter('fhincd', value),
    setVisualName: (value: string) => updateFilter('visualName', value),
    setResourceCd: (value: string) => updateFilter('resourceCd', value),
    setProcessFilter: (value: InspectionDrawingLibraryProcessFilter) => updateFilter('processFilter', value),
    setIncludeInactive: (value: boolean) => updateFilter('includeInactive', value),
    resetFilters,
    reload
  };
}
