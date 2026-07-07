import clsx from 'clsx';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { getResolvedClientKey } from '../../../api/client';
import { Button, buttonClassName } from '../../../components/ui/Button';
import {
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName,
  kioskInputClassName
} from '../../../features/kiosk/kioskTheme';

import { InspectionDrawingResourceCdChipList } from './InspectionDrawingResourceCdChipList';
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
  /** 図面 ID ごとの資源 CD（未指定時はチップ行を描画しない） */
  resourceCdsByVisualId?: Record<string, string[]>;
  resourceNameMap?: Record<string, string[]>;
};

export function KioskInspectionDrawingVisualLibrarySection({
  refreshToken,
  onRegisterClick,
  onVisualRenamed,
  previewVisuals,
  resourceCdsByVisualId,
  resourceNameMap = {}
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
      className="flex min-h-0 w-full max-w-full flex-col gap-2 rounded border border-white/15 bg-slate-900/70 p-2 2xl:w-[31rem] 2xl:shrink-0"
      aria-labelledby="inspection-drawing-visual-library-heading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="inspection-drawing-visual-library-heading" className="shrink-0 text-[1.15rem] font-bold leading-tight">
          図面ライブラリ
        </h2>
        <div className="w-[8.75rem] max-w-full shrink-0">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="図面名で検索"
            aria-label="図面名で検索"
            className={clsx(kioskInputClassName, 'w-full text-sm placeholder:text-white/40')}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11 shrink-0 !px-2 !py-0 text-sm"
            disabled={loading}
            onClick={() => void reload()}
          >
            {loading ? '更新中…' : '再読込'}
          </Button>
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11 shrink-0 !px-2 !py-0 text-sm"
            onClick={onRegisterClick}
          >
            図面を登録
          </Button>
        </div>
      </div>

      {error ? <p className="text-[0.98rem] font-semibold text-amber-200">{error}</p> : null}

      <div
        className="min-h-0 flex-1 overflow-auto rounded border border-white/10 bg-slate-950/40 p-1.5"
        data-testid="inspection-visual-library-scroll"
      >
        {loading && visuals.length === 0 ? (
          <p className="py-4 text-center text-[0.88rem] text-white/60">読込中…</p>
        ) : visuals.length === 0 ? (
          <p className="py-4 text-center text-[0.88rem] text-white/60">
            {debouncedQuery ? '条件に合う図面はありません。' : '登録済み図面はありません。'}
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-xs" aria-label="図面ライブラリ">
            <colgroup>
              <col className="w-[60%]" data-testid="inspection-visual-name-column" />
              <col className="w-[22%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="sticky top-0 bg-slate-900 text-xs text-white/70">
              <tr className="border-b border-white/10">
                <th className="px-2 py-1.5 font-bold">図面名</th>
                <th className="px-2 py-1.5 font-bold">更新</th>
                <th className="px-2 py-1.5 text-right font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {visuals.map((visual) => {
                const resourceCds = resourceCdsByVisualId?.[visual.id];
                const showResourceRow = resourceCds != null && resourceCds.length > 0;

                return (
                  <Fragment key={visual.id}>
                    <tr className="border-t border-white/10 first:border-t-0">
                      <td className="truncate px-2 pb-0.5 pt-1.5 font-bold text-white" title={visual.name}>
                        {visual.name}
                      </td>
                      <td className="whitespace-nowrap px-2 pb-0.5 pt-1.5 font-semibold text-white/65">
                        {formatVisualLibraryTimestamp(visual.updatedAt)}
                      </td>
                      <td className="px-2 pb-0.5 pt-1.5">
                        <div className="flex justify-end gap-1">
                          <Link
                            to={kioskInspectionDrawingCreatePathWithVisual(visual.id)}
                            state={INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE}
                            title="新規作成"
                            className={buttonClassName(
                              'primary',
                              clsx(kioskButtonPrimaryClassName, 'inline-flex shrink-0 items-center justify-center !px-1.5 !py-0 text-xs leading-none whitespace-nowrap')
                            )}
                          >
                            新規
                          </Link>
                          <button
                            type="button"
                            title="名称変更"
                            className={clsx(kioskButtonSecondaryClassName, 'min-h-11 shrink-0 whitespace-nowrap !px-1.5 !py-0 text-xs leading-none')}
                            disabled={isPreview}
                            onClick={() => setRenameTarget(visual)}
                          >
                            名称
                          </button>
                        </div>
                      </td>
                    </tr>
                    {showResourceRow ? (
                      <tr className="border-b border-white/10 last:border-b-0">
                        <td colSpan={3} className="px-2 pb-1 pt-0 text-xs text-white/55">
                          <InspectionDrawingResourceCdChipList
                            resourceCds={resourceCds}
                            resourceNameMap={resourceNameMap}
                            testId="inspection-visual-resource-chips"
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
