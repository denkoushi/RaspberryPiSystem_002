import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';
import { KioskDocumentPageImage } from '../KioskDocumentPageImage';

import type { AssemblyProcedureDocumentPageDto, AssemblyProcedureOverlayAssetDto } from '../types';

export function AssemblyProcedureDocumentEditorPageList({
  pages,
  assets,
  selectedPageIndex,
  onSelect,
  onAddBlankPage,
  disabled
}: {
  pages: AssemblyProcedureDocumentPageDto[];
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  selectedPageIndex: number;
  onSelect: (pageIndex: number) => void;
  onAddBlankPage: () => void;
  disabled: boolean;
}) {
  return (
    <aside className="flex min-h-0 flex-col items-center gap-2 overflow-auto border-r border-[#27313b] bg-[#161c22] px-2 py-2.5" aria-label="手順書ページ一覧">
      <div className="flex w-full flex-col items-center gap-2">
        {pages.map((page) => {
          const selected = page.pageIndex === selectedPageIndex;
          return (
            <button
              key={page.pageIndex}
              type="button"
              className={`relative block w-[100px] shrink-0 overflow-hidden rounded border-2 bg-white text-left ${selected ? 'border-[#5fc3e8]' : 'border-transparent'}`}
              aria-current={selected ? 'true' : undefined}
              aria-label={`${page.pageIndex + 1}ページ目${selected ? '（選択中）' : ''}`}
              aria-pressed={selected}
              onClick={() => onSelect(page.pageIndex)}
            >
              <div className="relative aspect-[1/1.414] overflow-hidden rounded bg-white">
                <KioskDocumentPageImage
                  pageUrl={page.imageRelativePath}
                  alt=""
                  className="h-full w-full object-contain"
                  loadingFallback={<span />}
                  errorFallback={<span className="flex h-full items-center justify-center text-[0.6rem] text-red-600">読込失敗</span>}
                />
                <AssemblyProcedureOverlayLayer elements={page.overlays} assets={assets} />
              </div>
              <span className="absolute bottom-1 left-1.5 font-mono text-sm text-[#333]">{page.pageIndex + 1}</span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="白紙ページを追加" className="h-12 w-[100px] shrink-0 rounded-lg border border-dashed border-[#344252] text-[26px] text-[#9fadb9] disabled:opacity-40" disabled={disabled} onClick={onAddBlankPage}>＋</button>
    </aside>
  );
}
