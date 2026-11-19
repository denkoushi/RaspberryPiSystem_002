import { memo, useEffect, useRef, useState } from 'react';

import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';
import { KioskDocumentPageImage } from '../KioskDocumentPageImage';

import type { AssemblyProcedureDocumentPageDto, AssemblyProcedureOverlayAssetDto } from '../types';

export const AssemblyProcedureDocumentEditorPageList = memo(function AssemblyProcedureDocumentEditorPageList({
  pages,
  assets,
  selectedPageIndex,
  onSelect,
  onAddBlankPage,
  onImportPages,
  onDeletePage,
  disabled,
  locked = false
}: {
  pages: AssemblyProcedureDocumentPageDto[];
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  selectedPageIndex: number;
  onSelect: (pageIndex: number) => void;
  onAddBlankPage: () => void;
  onImportPages: () => void;
  onDeletePage: (pageIndex: number) => void;
  disabled: boolean;
  locked?: boolean;
}) {
  return (
    <aside className="flex min-h-0 flex-col items-center gap-2 overflow-auto border-r border-[#27313b] bg-[#161c22] px-2 py-2.5" aria-label="手順書ページ一覧">
      <div className="flex w-full flex-col items-center gap-2">
        {pages.map((page) => {
          return <div key={page.pageIndex} className="relative w-[100px] shrink-0">
            <PageThumbnail page={page} assets={assets} selected={page.pageIndex === selectedPageIndex} onSelect={onSelect} locked={locked} />
            {pages.length > 1 && page.pageIndex === selectedPageIndex ? <button
              type="button"
              aria-label="このページを削除"
              disabled={disabled || locked}
              className="absolute -right-[6px] -top-[6px] z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[#344252] bg-[#161c22] text-red-400 disabled:opacity-40"
              onClick={() => onDeletePage(page.pageIndex)}
            ><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="m4 4 8 8M12 4l-8 8" /></svg></button> : null}
          </div>;
        })}
      </div>
      <button type="button" aria-label="白紙ページを追加" className="h-12 w-[100px] shrink-0 rounded-lg border border-dashed border-[#344252] text-[26px] text-[#9fadb9] disabled:opacity-40" disabled={disabled} onClick={onAddBlankPage}>＋</button>
      <button type="button" aria-label="ほかの要領書から入れる" title="ほかの要領書から入れる"
        className="grid h-12 w-[100px] shrink-0 place-items-center rounded-lg border border-dashed border-[#344252] text-[#9fadb9] disabled:opacity-40"
        disabled={disabled || locked} onClick={onImportPages}>
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 3h4l4 4v14H9v-5m8-13v5h4M3 12h12m-4-4 4 4-4 4" />
        </svg>
      </button>
    </aside>
  );
});

const PageThumbnail = memo(function PageThumbnail({ page, assets, selected, onSelect, locked }: {
  page: AssemblyProcedureDocumentPageDto;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  selected: boolean;
  onSelect: (pageIndex: number) => void;
  locked: boolean;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      className={`relative block w-[100px] shrink-0 overflow-hidden rounded border-2 bg-white text-left ${selected ? 'border-[#5fc3e8]' : 'border-transparent'}`}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${page.pageIndex + 1}ページ目${selected ? '（選択中）' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(page.pageIndex)}
    >
      <AssemblyProcedureDocumentEditorPagePreview page={page} assets={assets} lazy />
      <span className="absolute bottom-1 left-1.5 font-mono text-sm text-[#333]">{page.pageIndex + 1}</span>
    </button>
  );
});

export const AssemblyProcedureDocumentEditorPagePreview = memo(function AssemblyProcedureDocumentEditorPagePreview({ page, assets, lazy = false }: {
  page: AssemblyProcedureDocumentPageDto;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  lazy?: boolean;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [hasIntersected, setHasIntersected] = useState(false);
  const showContent = !lazy || hasIntersected || typeof IntersectionObserver === 'undefined';

  useEffect(() => {
    const preview = previewRef.current;
    if (showContent || !preview) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setHasIntersected(true);
    }, { rootMargin: '300px' });
    observer.observe(preview);
    return () => observer.disconnect();
  }, [showContent]);

  return <div ref={previewRef} className="relative aspect-[1/1.414] overflow-hidden rounded bg-white">
    {showContent ? <>
      <KioskDocumentPageImage
        pageUrl={page.imageRelativePath}
        alt=""
        className="h-full w-full object-contain"
        loadingFallback={<span />}
        errorFallback={<span className="flex h-full items-center justify-center text-[0.6rem] text-red-600">読込失敗</span>}
      />
      <AssemblyProcedureOverlayLayer elements={page.overlays} assets={assets} />
    </> : null}
  </div>;
});
