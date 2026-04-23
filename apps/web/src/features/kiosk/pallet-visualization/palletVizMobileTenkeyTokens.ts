/**
 * 配膳スマホパレット・テンキー行の Tailwind 断片（寸法の単一ソース）。
 * 静的 HTML プレビュー（design-previews）と齟齬が出た場合はここを正とする。
 */
export const palletVizMobileTenkeyTokens = {
  clearButton: 'min-h-12 shrink-0 !w-[4.25rem] px-1 text-xs',
  arrowButton: 'min-h-12 min-w-0 flex-1 !w-auto px-0 text-2xl font-extrabold leading-none',
  scanButton: 'min-h-12 !w-[9rem] shrink-0 overflow-hidden px-0',
  scanGlyph: 'h-[2.625rem] w-[2.625rem]',
} as const;
