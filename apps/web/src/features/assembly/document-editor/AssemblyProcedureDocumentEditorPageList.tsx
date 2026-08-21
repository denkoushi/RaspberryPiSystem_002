import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';
import { KioskDocumentPageImage } from '../KioskDocumentPageImage';

import type { AssemblyProcedureDocumentPageDto, AssemblyProcedureOverlayAssetDto } from '../types';

export function AssemblyProcedureDocumentEditorPageList({
  pages,
  assets,
  selectedPageIndex,
  onSelect
}: {
  pages: AssemblyProcedureDocumentPageDto[];
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  selectedPageIndex: number;
  onSelect: (pageIndex: number) => void;
}) {
  return (
    <aside className="flex min-h-0 w-full flex-row gap-2 overflow-hidden border-r border-white/10 bg-slate-900/75 p-2 xl:w-52 xl:flex-col xl:shrink-0" aria-label="手順書ページ一覧">
      <h2 className="shrink-0 text-sm font-bold">ページ</h2>
      <div className="flex min-h-0 min-w-0 flex-1 gap-1.5 overflow-x-auto overflow-y-hidden xl:block xl:space-y-1.5 xl:overflow-auto">
        {pages.map((page) => {
          const selected = page.pageIndex === selectedPageIndex;
          return (
            <button
              key={page.pageIndex}
              type="button"
              className={`relative block min-h-11 min-w-[6rem] rounded border p-1 text-left xl:min-w-0 xl:w-full ${selected ? 'border-cyan-300 bg-cyan-950/70' : 'border-white/10 bg-slate-950/60 hover:bg-white/10'}`}
              aria-label={`${page.pageIndex + 1}ページ目${selected ? '（選択中）' : ''}`}
              aria-pressed={selected}
              onClick={() => onSelect(page.pageIndex)}
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded bg-white">
                <KioskDocumentPageImage
                  pageUrl={page.imageRelativePath}
                  alt=""
                  className="h-full w-full object-contain"
                  loadingFallback={<span />}
                  errorFallback={<span className="flex h-full items-center justify-center text-[0.6rem] text-red-600">読込失敗</span>}
                />
                <AssemblyProcedureOverlayLayer elements={page.overlays} assets={assets} />
              </div>
              <span className="mt-1 block truncate text-xs font-semibold">{page.pageIndex + 1}ページ</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
