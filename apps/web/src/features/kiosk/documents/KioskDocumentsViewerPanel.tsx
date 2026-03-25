import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

import type { KioskDocumentLayoutMode } from './kioskDocumentPageLayout';

export type KioskDocumentWidthMode = 'default' | 'fit';

export type KioskDocumentsViewerPanelProps = {
  listOpen: boolean;
  onToggleList: () => void;
  layoutMode: KioskDocumentLayoutMode;
  onLayoutModeChange: (mode: KioskDocumentLayoutMode) => void;
  widthMode: KioskDocumentWidthMode;
  onWidthModeChange: (mode: KioskDocumentWidthMode) => void;
  zoom: number;
  onZoomDecrease: () => void;
  onZoomIncrease: () => void;
  onZoomReset: () => void;
  selectedId: string | null;
  documentTitle: string | null;
  detailLoading: boolean;
  detailError: boolean;
  pagePairs: string[][];
  resolveImageUrl: (apiPath: string) => string;
};

export function KioskDocumentsViewerPanel({
  listOpen,
  onToggleList,
  layoutMode,
  onLayoutModeChange,
  widthMode,
  onWidthModeChange,
  zoom,
  onZoomDecrease,
  onZoomIncrease,
  onZoomReset,
  selectedId,
  documentTitle,
  detailLoading,
  detailError,
  pagePairs,
  resolveImageUrl,
}: KioskDocumentsViewerPanelProps) {
  const zoomActive = widthMode === 'default';

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-white/10 bg-slate-900/40"
      aria-label="要領書ビューア"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
        <Button
          type="button"
          variant="ghost"
          className="px-2 py-1 text-xs text-white/90"
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
            variant="ghost"
            className="px-2 py-1 text-white"
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
            variant="ghost"
            className="px-2 py-1 text-white"
            onClick={onZoomIncrease}
            disabled={!zoomActive}
          >
            ＋
          </Button>
          <Button
            type="button"
            variant="ghost"
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
        {documentTitle ? (
          <span className="ml-auto truncate text-xs text-white/60" title={documentTitle}>
            {documentTitle}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!selectedId ? (
          <p className="text-sm text-white/60">一覧から文書を選択してください（一覧が閉じている場合は「一覧を表示」）</p>
        ) : detailLoading ? (
          <p className="text-sm text-white/60">表示準備中…</p>
        ) : detailError ? (
          <p className="text-sm text-red-300">文書の読み込みに失敗しました</p>
        ) : pagePairs.length === 0 ? (
          <p className="text-sm text-white/60">ページ画像がありません（PDFの再変換が必要な場合があります）</p>
        ) : widthMode === 'default' ? (
          <div
            className="inline-block min-w-full"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            <div className="space-y-4">
              {pagePairs.map((pair, rowIdx) => (
                <div
                  key={`row-${rowIdx}`}
                  className={clsx(
                    'flex flex-wrap justify-center gap-4',
                    layoutMode === 'spread' && pair.length === 1 ? 'justify-center' : ''
                  )}
                >
                  {pair.map((url) => (
                    <div
                      key={url}
                      className={clsx(
                        'flex justify-center',
                        layoutMode === 'spread' ? 'w-[min(100%,48%)] min-w-[280px]' : 'w-full max-w-4xl'
                      )}
                    >
                      <img
                        src={resolveImageUrl(url)}
                        alt=""
                        className="max-w-full rounded border border-white/10 shadow-lg"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="w-full min-w-0 space-y-4">
            {pagePairs.map((pair, rowIdx) => (
              <div
                key={`row-${rowIdx}`}
                className={clsx(
                  'flex w-full min-w-0 flex-wrap gap-4',
                  layoutMode === 'spread' ? 'justify-stretch' : 'justify-center'
                )}
              >
                {pair.map((url) => (
                  <div
                    key={url}
                    className={clsx(
                      'flex min-w-0 justify-center',
                      layoutMode === 'spread' && pair.length > 1 ? 'flex-1 basis-0' : 'w-full'
                    )}
                  >
                    <img
                      src={resolveImageUrl(url)}
                      alt=""
                      className="h-auto w-full max-w-full rounded border border-white/10 shadow-lg"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
