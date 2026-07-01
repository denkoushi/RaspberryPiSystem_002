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
import { KioskInspectionDrawingVisualRenameModal } from './KioskInspectionDrawingVisualRenameModal';
import { useInspectionDrawingVisualLibrary } from './useInspectionDrawingVisualLibrary';

import type { PartMeasurementVisualTemplateDto } from '../types';

type Props = {
  refreshToken?: number;
  onRegisterClick: () => void;
  /** 図面名変更成功時 — 同一画面のテンプレ一覧表示を同期する */
  onVisualRenamed?: (visual: PartMeasurementVisualTemplateDto) => void;
  /** 開発プレビュー用 — 指定時は API を呼ばずモック一覧を表示 */
  previewVisuals?: PartMeasurementVisualTemplateDto[];
};

export function KioskInspectionDrawingVisualLibrarySection({
  refreshToken,
  onRegisterClick,
  onVisualRenamed,
  previewVisuals
}: Props) {
  const clientKey = getResolvedClientKey();
  const isPreview = previewVisuals != null;
  const [previewSearchQuery, setPreviewSearchQuery] = useState('');
  const [renameTarget, setRenameTarget] = useState<PartMeasurementVisualTemplateDto | null>(null);
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
      className="grid w-[28rem] max-w-full shrink-0 gap-2 rounded border border-white/15 bg-slate-900/70 p-2"
      aria-labelledby="inspection-drawing-visual-library-heading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="inspection-drawing-visual-library-heading" className="shrink-0 text-[1.15rem] font-bold leading-tight">
          図面ライブラリ
        </h2>
        <div className="w-[8.75rem] max-w-full shrink-0">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="図面名で検索"
            aria-label="図面名で検索"
            className="min-h-9 w-full px-2 text-[0.9rem] text-slate-900 placeholder-slate-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-9 shrink-0 !px-2 !py-0 text-[0.86rem]"
            disabled={loading}
            onClick={() => void reload()}
          >
            {loading ? '更新中…' : '再読込'}
          </Button>
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-9 shrink-0 !px-2 !py-0 text-[0.86rem]"
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
          <table className="w-full table-fixed border-collapse text-left text-[0.82rem]" aria-label="図面ライブラリ">
            <colgroup>
              <col className="w-[12.5rem]" />
              <col className="w-[5.8rem]" />
              <col className="w-[6.1rem]" />
            </colgroup>
            <thead className="sticky top-0 bg-slate-900 text-[0.74rem] text-white/70">
              <tr className="border-b border-white/10">
                <th className="px-2 py-1.5 font-bold">図面名</th>
                <th className="px-2 py-1.5 font-bold">更新</th>
                <th className="px-2 py-1.5 text-right font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {visuals.map((visual) => (
                <tr key={visual.id} className="border-b border-white/10 last:border-b-0">
                  <td className="truncate px-2 py-1.5 font-bold text-white" title={visual.name}>
                    {visual.name}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-white/65">
                    {formatVisualLibraryTimestamp(visual.updatedAt)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-1">
                      <Link
                        to={kioskInspectionDrawingCreatePathWithVisual(visual.id)}
                        state={INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE}
                        title="新規作成"
                        className={buttonClassName(
                          'primary',
                          'inline-flex min-h-6 shrink-0 items-center justify-center rounded !px-1.5 !py-0 text-[0.68rem] leading-none whitespace-nowrap'
                        )}
                      >
                        新規
                      </Link>
                      <Button
                        type="button"
                        variant="secondary"
                        title="名称変更"
                        className="min-h-6 shrink-0 whitespace-nowrap rounded !px-1.5 !py-0 text-[0.68rem] leading-none"
                        disabled={isPreview}
                        onClick={() => setRenameTarget(visual)}
                      >
                        名称
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <KioskInspectionDrawingVisualRenameModal
        isOpen={renameTarget != null}
        visual={renameTarget}
        clientKey={clientKey}
        onClose={() => setRenameTarget(null)}
        onSuccess={(visual) => {
          setRenameTarget(null);
          onVisualRenamed?.(visual);
          void reload();
        }}
      />
    </section>
  );
}
