import clsx from 'clsx';
import { useLayoutEffect, useRef } from 'react';

import { HoverRevealCollapsibleToolbar } from '../../../components/kiosk/HoverRevealCollapsibleToolbar';
import { useTimedHoverReveal } from '../../../hooks/useTimedHoverReveal';

import { KioskDocumentsViewerToolbar } from './KioskDocumentsViewerToolbar';
import { KioskDocumentViewerPageRow } from './KioskDocumentViewerPageRow';
import { useKioskDocumentNearVisibleRows } from './useKioskDocumentNearVisibleRows';

import type { KioskDocumentLayoutMode, KioskDocumentWidthMode } from './kioskDocumentPageLayout';
import type { KioskDocumentSearchSnippetModel } from './search/kiosk-document-search-snippets';

export type { KioskDocumentWidthMode } from './kioskDocumentPageLayout';

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
  snippetModel: KioskDocumentSearchSnippetModel;
  detailLoading: boolean;
  detailError: boolean;
  pagePairs: string[][];
  resolveImageUrl: (apiPath: string) => string;
  /** false のときツールバーを常時表示（テスト等）。既定 true */
  toolbarRevealEnabled?: boolean;
};

const DOCS_VIEWER_TOOLBAR_TRIGGER_TITLE =
  'マウスを乗せて一覧・見開き・ズーム・検索ヒットなどを表示';

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
  snippetModel,
  detailLoading,
  detailError,
  pagePairs,
  resolveImageUrl,
  toolbarRevealEnabled = true,
}: KioskDocumentsViewerPanelProps) {
  const zoomActive = widthMode === 'default';
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolbarReveal = useTimedHoverReveal(toolbarRevealEnabled);
  const rowCount = pagePairs.length;

  const { setRowElement, shouldShowImage } = useKioskDocumentNearVisibleRows(scrollRef, rowCount, {
    documentKey: selectedId,
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedId) return;
    el.scrollTop = 0;
  }, [selectedId]);

  const toolbar = (
    <KioskDocumentsViewerToolbar
      listOpen={listOpen}
      onToggleList={onToggleList}
      layoutMode={layoutMode}
      onLayoutModeChange={onLayoutModeChange}
      widthMode={widthMode}
      onWidthModeChange={onWidthModeChange}
      zoom={zoom}
      zoomActive={zoomActive}
      onZoomDecrease={onZoomDecrease}
      onZoomIncrease={onZoomIncrease}
      onZoomReset={onZoomReset}
      snippetModel={snippetModel}
    />
  );

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-white/10 bg-slate-900/40"
      aria-label="要領書ビューア"
    >
      {toolbarRevealEnabled ? (
        <HoverRevealCollapsibleToolbar
          title="表示オプション"
          statusMessage={null}
          expanded={toolbarReveal.isVisible}
          onTriggerEnter={toolbarReveal.onHotZoneEnter}
          onPanelMouseEnter={toolbarReveal.onHeaderMouseEnter}
          onPanelMouseLeave={toolbarReveal.onHeaderMouseLeave}
          ariaRegionLabel="要領書の表示オプションと検索ヒット"
          triggerTitle={DOCS_VIEWER_TOOLBAR_TRIGGER_TITLE}
          className="border-b border-white/10 px-2 pt-2"
          titleClassName="text-xs font-semibold text-teal-200"
          statusMessageClassName="text-xs text-teal-200"
          triggerButtonClassName={clsx(
            'flex min-h-10 min-w-10 shrink-0 cursor-default items-center justify-center rounded border border-white/15',
            'text-teal-200/90 hover:border-teal-200/40 hover:bg-white/5'
          )}
          expandedMaxHeightClassName="max-h-[min(28rem,85vh)]"
        >
          {toolbar}
        </HoverRevealCollapsibleToolbar>
      ) : (
        toolbar
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-3">
        {!selectedId ? (
          <p className="text-sm text-white/60">
            一覧から文書を選択してください（一覧が閉じている場合は「一覧を表示」）
          </p>
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
                <KioskDocumentViewerPageRow
                  key={`row-${rowIdx}`}
                  rowIndex={rowIdx}
                  pair={pair}
                  layoutMode={layoutMode}
                  widthMode="default"
                  showImage={shouldShowImage(rowIdx)}
                  resolveImageUrl={resolveImageUrl}
                  setRowElement={setRowElement}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="w-full min-w-0 space-y-4">
            {pagePairs.map((pair, rowIdx) => (
              <KioskDocumentViewerPageRow
                key={`row-${rowIdx}`}
                rowIndex={rowIdx}
                pair={pair}
                layoutMode={layoutMode}
                widthMode="fit"
                showImage={shouldShowImage(rowIdx)}
                resolveImageUrl={resolveImageUrl}
                setRowElement={setRowElement}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
