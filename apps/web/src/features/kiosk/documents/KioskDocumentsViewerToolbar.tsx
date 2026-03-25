import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

import type { KioskDocumentLayoutMode, KioskDocumentWidthMode } from './kioskDocumentPageLayout';

export type KioskDocumentsViewerToolbarProps = {
  listOpen: boolean;
  onToggleList: () => void;
  layoutMode: KioskDocumentLayoutMode;
  onLayoutModeChange: (mode: KioskDocumentLayoutMode) => void;
  widthMode: KioskDocumentWidthMode;
  onWidthModeChange: (mode: KioskDocumentWidthMode) => void;
  zoom: number;
  zoomActive: boolean;
  onZoomDecrease: () => void;
  onZoomIncrease: () => void;
  onZoomReset: () => void;
  documentTitle: string | null;
};

export function KioskDocumentsViewerToolbar({
  listOpen,
  onToggleList,
  layoutMode,
  onLayoutModeChange,
  widthMode,
  onWidthModeChange,
  zoom,
  zoomActive,
  onZoomDecrease,
  onZoomIncrease,
  onZoomReset,
  documentTitle,
}: KioskDocumentsViewerToolbarProps) {
  return (
    <div className="space-y-2 border-b border-white/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghostOnDark"
          className="px-2 py-1 text-xs"
          onClick={onToggleList}
          aria-expanded={listOpen}
          aria-controls="kiosk-documents-list-panel"
          id="kiosk-documents-toggle-list"
        >
          {listOpen ? '一覧を隠す' : '一覧を表示'}
        </Button>
        <div className="hidden h-6 w-px bg-white/15 sm:block" aria-hidden />
        <div className="flex gap-1 rounded-md bg-slate-950/60 p-1">
          <button
            type="button"
            className={clsx(
              'rounded px-3 py-1.5 text-xs font-semibold',
              layoutMode === 'single' ? 'bg-teal-600 text-white' : 'text-white/70 hover:text-white'
            )}
            onClick={() => onLayoutModeChange('single')}
          >
            1ページ
          </button>
          <button
            type="button"
            className={clsx(
              'rounded px-3 py-1.5 text-xs font-semibold',
              layoutMode === 'spread' ? 'bg-teal-600 text-white' : 'text-white/70 hover:text-white'
            )}
            onClick={() => onLayoutModeChange('spread')}
          >
            見開き
          </button>
        </div>
        <div className="flex gap-1 rounded-md bg-slate-950/60 p-1">
          <button
            type="button"
            className={clsx(
              'rounded px-2.5 py-1.5 text-xs font-semibold',
              widthMode === 'default' ? 'bg-teal-600 text-white' : 'text-white/70 hover:text-white'
            )}
            onClick={() => onWidthModeChange('default')}
          >
            標準幅
          </button>
          <button
            type="button"
            className={clsx(
              'rounded px-2.5 py-1.5 text-xs font-semibold',
              widthMode === 'fit' ? 'bg-teal-600 text-white' : 'text-white/70 hover:text-white'
            )}
            onClick={() => onWidthModeChange('fit')}
          >
            幅いっぱい
          </button>
        </div>
        <div
          className={clsx('flex items-center gap-1', !zoomActive && 'opacity-50')}
          aria-disabled={!zoomActive}
        >
          <Button
            type="button"
            variant="ghostOnDark"
            className="px-2 py-1"
            onClick={onZoomDecrease}
            disabled={!zoomActive}
          >
            −
          </Button>
          <span className="min-w-[3.5rem] text-center text-xs text-white/80">
            {zoomActive ? `${Math.round(zoom * 100)}%` : '—'}
          </span>
          <Button
            type="button"
            variant="ghostOnDark"
            className="px-2 py-1"
            onClick={onZoomIncrease}
            disabled={!zoomActive}
          >
            ＋
          </Button>
          <Button
            type="button"
            variant="ghostOnDark"
            className="px-2 py-1 text-xs text-white/80"
            onClick={onZoomReset}
            disabled={!zoomActive}
          >
            リセット
          </Button>
        </div>
        {!zoomActive ? (
          <span className="text-xs text-white/50">横幅フィット中はズーム無効</span>
        ) : null}
      </div>
      {documentTitle ? (
        <div className="min-w-0 truncate text-xs text-white/60" title={documentTitle}>
          {documentTitle}
        </div>
      ) : null}
    </div>
  );
}
