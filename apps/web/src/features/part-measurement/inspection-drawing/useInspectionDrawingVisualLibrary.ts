import { useCallback, useEffect, useRef, useState } from 'react';

import { listPartMeasurementVisualTemplates } from '../../../api/client';

import {
  INSPECTION_DRAWING_VISUAL_LIBRARY_LIMIT,
  INSPECTION_DRAWING_VISUAL_LIBRARY_FETCH_LIMIT,
  INSPECTION_DRAWING_VISUAL_LIBRARY_SORT,
  INSPECTION_DRAWING_VISUAL_SEARCH_DEBOUNCE_MS
} from './inspectionDrawingVisualLibraryConstants';

import type { PartMeasurementVisualTemplateDto } from '../types';

type UseInspectionDrawingVisualLibraryOptions = {
  clientKey?: string;
  /** 親から再読込を促すトークン（登録成功後に increment） */
  refreshToken?: number;
  /** false のとき一覧 API を呼ばない（開発プレビュー等） */
  enabled?: boolean;
  /** 上部数字テンキーの debounce 済み検索値 */
  digitQuery?: string;
};

export function useInspectionDrawingVisualLibrary(options: UseInspectionDrawingVisualLibraryOptions) {
  const { clientKey, refreshToken = 0, enabled = true, digitQuery = '' } = options;
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [visuals, setVisuals] = useState<PartMeasurementVisualTemplateDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRequestSeqRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, INSPECTION_DRAWING_VISUAL_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const requestSeq = ++searchRequestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const list = await listPartMeasurementVisualTemplates(
        {
          q: debouncedQuery || undefined,
          digitQuery: digitQuery || undefined,
          limit: INSPECTION_DRAWING_VISUAL_LIBRARY_FETCH_LIMIT,
          sort: INSPECTION_DRAWING_VISUAL_LIBRARY_SORT
        },
        clientKey
      );
      if (searchRequestSeqRef.current !== requestSeq) return;
      setVisuals(list.slice(0, INSPECTION_DRAWING_VISUAL_LIBRARY_LIMIT));
      setHasMore(list.length > INSPECTION_DRAWING_VISUAL_LIBRARY_LIMIT);
    } catch (e: unknown) {
      if (searchRequestSeqRef.current !== requestSeq) return;
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message ?? '図面ライブラリの取得に失敗しました。');
      setVisuals([]);
      setHasMore(false);
    } finally {
      if (searchRequestSeqRef.current === requestSeq) {
        setLoading(false);
      }
    }
  }, [clientKey, debouncedQuery, digitQuery, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload, refreshToken]);

  return {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    visuals,
    hasMore,
    loading,
    error,
    reload
  };
}
