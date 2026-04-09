import clsx from 'clsx';

import type { KioskDocumentLayoutMode, KioskDocumentWidthMode } from './kioskDocumentPageLayout';

const KIOSK_DOCUMENT_PAGE_ASPECT_RATIO = '1490 / 2108';

export type KioskDocumentViewerPageRowProps = {
  rowIndex: number;
  pair: string[];
  layoutMode: KioskDocumentLayoutMode;
  widthMode: KioskDocumentWidthMode;
  showImage: boolean;
  resolveImageUrl: (apiPath: string) => string;
  setRowElement: (index: number, node: HTMLElement | null) => void;
};

export function KioskDocumentViewerPageRow({
  rowIndex,
  pair,
  layoutMode,
  widthMode,
  showImage,
  resolveImageUrl,
  setRowElement,
}: KioskDocumentViewerPageRowProps) {
  const defaultPageWrapperClass = clsx(
    'flex justify-center',
    layoutMode === 'spread' ? 'w-[min(100%,48%)] min-w-[280px]' : 'w-full max-w-4xl'
  );
  const fitPageWrapperClass = clsx(
    'flex min-w-0 justify-center',
    layoutMode === 'spread' && pair.length > 1 ? 'flex-1 basis-0' : 'w-full'
  );

  return (
    <div
      ref={(node) => setRowElement(rowIndex, node)}
      data-kiosk-doc-row={String(rowIndex)}
      className={clsx(
        widthMode === 'default'
          ? clsx(
              'flex flex-wrap justify-center gap-4',
              layoutMode === 'spread' && pair.length === 1 ? 'justify-center' : ''
            )
          : clsx(
              'flex w-full min-w-0 flex-wrap gap-4',
              layoutMode === 'spread' ? 'justify-stretch' : 'justify-center'
            )
      )}
    >
      {!showImage ? (
        pair.map((url) => (
          <div
            key={url}
            className={widthMode === 'default' ? defaultPageWrapperClass : fitPageWrapperClass}
          >
            <div
              className="w-full rounded border border-white/5 bg-slate-950/40"
              style={{ aspectRatio: KIOSK_DOCUMENT_PAGE_ASPECT_RATIO }}
              aria-hidden
            />
          </div>
        ))
      ) : widthMode === 'default' ? (
        pair.map((url) => (
          <div key={url} className={defaultPageWrapperClass}>
            <img
              src={resolveImageUrl(url)}
              alt=""
              loading="lazy"
              decoding="async"
              className="max-w-full rounded border border-white/10 shadow-lg"
            />
          </div>
        ))
      ) : (
        pair.map((url) => (
          <div key={url} className={fitPageWrapperClass}>
            <img
              src={resolveImageUrl(url)}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-auto w-full max-w-full rounded border border-white/10 shadow-lg"
            />
          </div>
        ))
      )}
    </div>
  );
}
