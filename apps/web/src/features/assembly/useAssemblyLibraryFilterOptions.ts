import { useEffect, useMemo, useRef, useState } from 'react';

import { listAssemblyLibraryFilterOptions } from '../../api/client';

import type { AssemblyLibraryFilterField } from '../../api/domains/assembly';
import type { KioskFilterOption } from '../../components/kiosk/KioskFilterCombobox';

const FILTER_OPTIONS_DEBOUNCE_MS = 200;

export function useAssemblyLibraryFilterOptions(params: {
  field: AssemblyLibraryFilterField;
  query: string;
  includeInactive?: boolean;
  enabled?: boolean;
}) {
  const { field, query, includeInactive = false, enabled = true } = params;
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      const requestSeq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);
      void listAssemblyLibraryFilterOptions({
        field,
        q: query.trim() || undefined,
        includeInactive,
        limit: 50
      })
        .then((next) => {
          if (requestSeqRef.current === requestSeq) setValues(next);
        })
        .catch(() => {
          if (requestSeqRef.current !== requestSeq) return;
          setValues([]);
          setError('検索候補の取得に失敗しました。');
        })
        .finally(() => {
          if (requestSeqRef.current === requestSeq) setLoading(false);
        });
    }, FILTER_OPTIONS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, field, includeInactive, query]);

  const options = useMemo<KioskFilterOption[]>(
    () => values.map((value) => ({ value, label: value, searchText: value.toLocaleLowerCase() })),
    [values]
  );

  return { options, loading, error };
}
