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

type Props = {
  refreshToken?: number;
  onRegisterClick: () => void;
};

export function KioskInspectionDrawingVisualLibrarySection({ refreshToken, onRegisterClick }: Props) {
  const clientKey = getResolvedClientKey();
  const { searchQuery, setSearchQuery, debouncedQuery, visuals, loading, error, reload } =
    useInspectionDrawingVisualLibrary({ clientKey, refreshToken });

  return (
    <section
      className="grid gap-2 rounded border border-white/15 bg-slate-900/70 p-2"
      aria-labelledby="inspection-drawing-visual-library-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="inspection-drawing-visual-library-heading" className="text-[1.15rem] font-bold leading-tight">
            図面ライブラリ
          </h2>
          <p className="text-[0.92rem] text-white/65">
            図面だけを先に登録できます。後から新規作成で測定点・資源CDを追加してください。
          </p>
        </div>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-11 shrink-0 text-[1rem]"
          onClick={onRegisterClick}
        >
          図面を登録
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-[12rem] flex-1 gap-1 text-sm text-white/80">
          図面名で検索
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="部分一致"
            className="min-h-11 bg-slate-950/60 text-white"
          />
        </label>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-11 text-[0.98rem]"
          disabled={loading}
          onClick={() => void reload()}
        >
          {loading ? '更新中…' : '再読込'}
        </Button>
      </div>

      {error ? <p className="text-[0.98rem] font-semibold text-amber-200">{error}</p> : null}

      <div className="max-h-[18rem] overflow-auto rounded border border-white/10 bg-slate-950/40 p-2">
        {loading && visuals.length === 0 ? (
          <p className="py-6 text-center text-[0.98rem] text-white/60">読込中…</p>
        ) : visuals.length === 0 ? (
          <p className="py-6 text-center text-[0.98rem] text-white/60">
            {debouncedQuery ? '条件に合う図面はありません。' : '登録済み図面はありません。'}
          </p>
        ) : (
          <ul className="grid gap-2">
            {visuals.map((visual) => (
              <li
                key={visual.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-slate-900/80 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[1rem] font-semibold text-white">{visual.name}</p>
                  <p className="text-[0.88rem] text-white/60">
                    更新 {formatVisualLibraryTimestamp(visual.updatedAt)}
                  </p>
                </div>
                <Link
                  to={kioskInspectionDrawingCreatePathWithVisual(visual.id)}
                  state={INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE}
                  className={buttonClassName('primary', 'inline-flex min-h-10 shrink-0 items-center text-[0.95rem]')}
                >
                  この図面で新規作成
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
