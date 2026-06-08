import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { getResolvedClientKey } from '../../../api/client';
import { Button, buttonClassName } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';

import { formatVisualLibraryTimestamp } from './inspectionDrawingVisualLibraryHelpers';
import {
  INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE,
  kioskInspectionDrawingCreatePathWithVisual
} from './kioskInspectionDrawingRoutes';
import { useInspectionDrawingVisualLibrary } from './useInspectionDrawingVisualLibrary';

import type { PartMeasurementVisualTemplateDto } from '../types';

type Props = {
  refreshToken?: number;
  onRegisterClick: () => void;
  /** 開発プレビュー用 — 指定時は API を呼ばずモック一覧を表示 */
  previewVisuals?: PartMeasurementVisualTemplateDto[];
};

export function KioskInspectionDrawingVisualLibrarySection({
  refreshToken,
  onRegisterClick,
  previewVisuals
}: Props) {
  const clientKey = getResolvedClientKey();
  const isPreview = previewVisuals != null;
  const [previewSearchQuery, setPreviewSearchQuery] = useState('');
  const apiState = useInspectionDrawingVisualLibrary({
    clientKey,
    refreshToken,
    enabled: !isPreview
  });

  const previewDebouncedQuery = previewSearchQuery.trim();
  const previewFilteredVisuals = useMemo(() => {
    if (!isPreview) return [];
    const q = previewDebouncedQuery.toLowerCase();
    if (!q) return previewVisuals;
    return previewVisuals.filter((visual) => visual.name.toLowerCase().includes(q));
  }, [isPreview, previewDebouncedQuery, previewVisuals]);

  const searchQuery = isPreview ? previewSearchQuery : apiState.searchQuery;
  const setSearchQuery = isPreview ? setPreviewSearchQuery : apiState.setSearchQuery;
  const debouncedQuery = isPreview ? previewDebouncedQuery : apiState.debouncedQuery;
  const visuals = isPreview ? previewFilteredVisuals : apiState.visuals;
  const loading = isPreview ? false : apiState.loading;
  const error = isPreview ? null : apiState.error;
  const reload = isPreview ? async () => undefined : apiState.reload;

  return (
    <section
      className="grid gap-2 rounded border border-white/15 bg-slate-900/70 p-2"
      aria-labelledby="inspection-drawing-visual-library-heading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="inspection-drawing-visual-library-heading" className="shrink-0 text-[1.15rem] font-bold leading-tight">
          図面ライブラリ
        </h2>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="図面名で検索"
          aria-label="図面名で検索"
          className="min-h-11 w-1/5 min-w-[10rem] shrink-0 bg-slate-950/60 text-white"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11 shrink-0 text-[0.98rem]"
            disabled={loading}
            onClick={() => void reload()}
          >
            {loading ? '更新中…' : '再読込'}
          </Button>
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11 shrink-0 text-[1rem]"
            onClick={onRegisterClick}
          >
            図面を登録
          </Button>
        </div>
      </div>

      {error ? <p className="text-[0.98rem] font-semibold text-amber-200">{error}</p> : null}

      <div className="max-h-[22rem] overflow-auto rounded border border-white/10 bg-slate-950/40 p-1.5">
        {loading && visuals.length === 0 ? (
          <p className="py-4 text-center text-[0.88rem] text-white/60">読込中…</p>
        ) : visuals.length === 0 ? (
          <p className="py-4 text-center text-[0.88rem] text-white/60">
            {debouncedQuery ? '条件に合う図面はありません。' : '登録済み図面はありません。'}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visuals.map((visual) => (
              <li
                key={visual.id}
                className="flex min-w-0 flex-col gap-1 rounded border border-white/10 bg-slate-900/80 p-1.5"
              >
                <p className="line-clamp-2 min-h-[2.4em] text-[0.82rem] font-semibold leading-snug text-white">
                  {visual.name}
                </p>
                <p className="text-[0.72rem] text-white/55">
                  更新 {formatVisualLibraryTimestamp(visual.updatedAt)}
                </p>
                <Link
                  to={kioskInspectionDrawingCreatePathWithVisual(visual.id)}
                  state={INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE}
                  className={buttonClassName(
                    'primary',
                    'inline-flex min-h-9 w-full items-center justify-center px-1 text-[0.72rem]'
                  )}
                >
                  新規作成
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
