import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

import { KioskDocumentSearchSnippetStrip } from './KioskDocumentSearchSnippetStrip';
import {
  IconKioskCollapseListPanel,
  IconKioskExpandListPanel,
  IconKioskWidthDefault,
  IconKioskWidthFit,
} from './kioskDocumentsToolbarIcons';
import {
  isKioskDocumentSnippetStripVisible,
  type KioskDocumentSearchSnippetModel,
} from './search/kiosk-document-search-snippets';

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
  snippetModel: KioskDocumentSearchSnippetModel;
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
  snippetModel,
}: KioskDocumentsViewerToolbarProps) {
  const showSnippetStrip = isKioskDocumentSnippetStripVisible(snippetModel);

  return (
    <div className="border-b border-white/10 p-2">
      <div
        className={clsx(
          'flex gap-2',
          showSnippetStrip ? 'flex-col sm:flex-row sm:items-start' : 'flex-row flex-wrap items-center'
        )}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghostOnDark"
            className="px-2 py-1.5"
            onClick={onToggleList}
            aria-expanded={listOpen}
            aria-controls="kiosk-documents-list-panel"
            id="kiosk-documents-toggle-list"
            aria-label={listOpen ? '一覧を隠す' : '一覧を表示'}
            title={listOpen ? '一覧を隠す' : '一覧を表示'}
          >
            {listOpen ? <IconKioskCollapseListPanel /> : <IconKioskExpandListPanel />}
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
                'rounded p-1.5',
                widthMode === 'default' ? 'bg-teal-600 text-white' : 'text-white/70 hover:text-white'
              )}
              onClick={() => onWidthModeChange('default')}
              aria-label="標準幅表示"
              title="標準幅（ズーム可）"
            >
              <IconKioskWidthDefault />
            </button>
            <button
              type="button"
              className={clsx(
                'rounded p-1.5',
                widthMode === 'fit' ? 'bg-teal-600 text-white' : 'text-white/70 hover:text-white'
              )}
              onClick={() => onWidthModeChange('fit')}
              aria-label="横幅いっぱいに表示"
              title="横幅いっぱい（ズーム無効）"
            >
              <IconKioskWidthFit />
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
        </div>

        {showSnippetStrip ? (
          <div className="min-h-0 min-w-0 flex-1 max-h-24 overflow-y-auto rounded-md border border-white/10 bg-slate-950/40 px-2 py-1.5 sm:pl-3">
            <KioskDocumentSearchSnippetStrip model={snippetModel} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
