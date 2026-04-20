/**
 * 配膳スマホ（キオスク）向けの高視認テーマ用 Tailwind クラス群。
 * 画面コンポーネントはここを参照し、色・枠の意味を1箇所に集約する。
 */
export const mpKioskTheme = {
  /** 照合ヘッダ（折りたたみ1行） */
  verifyCollapsedBar:
    'flex shrink-0 items-center gap-2 border-b-2 border-neutral-600 bg-[#1a1a1a] px-2 py-1.5',
  verifyCollapsedTitle: 'min-w-0 flex-1 text-sm font-extrabold text-white',
  verifyCollapsedHint: 'hidden text-[11px] font-medium text-neutral-400 sm:inline',
  verifyExpandButton:
    'shrink-0 rounded-lg border-2 border-sky-400 bg-[#0c4a6e] px-3 py-1.5 text-[13px] font-extrabold text-white active:bg-sky-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40',

  /** ページ上部の補助導線 */
  partSearchButton:
    'rounded-lg border-2 border-sky-400 bg-[#0c4a6e] px-3 py-2 text-sm font-bold text-white active:bg-sky-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40',

  /** 下半: amber（棚選択）パネル */
  shelfPanelRoot:
    'flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 rounded-[10px] border-l-4 border-l-amber-400 bg-[#1c1300] px-2.5 py-2.5',
  shelfPanelHeaderRow: 'flex flex-wrap items-center gap-2',
  shelfQrButton:
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-sky-400 bg-[#0c4a6e] p-0 text-white active:bg-sky-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40',
  shelfQrIcon: 'h-7 w-7 text-white',
  selectedShelfCode:
    'max-w-[10rem] break-all text-[clamp(18px,5.2vw,24px)] font-extrabold leading-tight tracking-wide text-amber-400 tabular-nums',
  shelfRegisterAddButton:
    'ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-amber-500 bg-black text-2xl font-light leading-none text-amber-400 active:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40',

  shelfAxisGrid: 'grid grid-cols-6 gap-1.5',
  shelfAxisButtonBase:
    'flex h-11 min-h-11 max-h-11 w-full items-center justify-center rounded-lg border-2 border-amber-700 bg-[#292000] px-0.5 text-[clamp(15px,4.2vw,20px)] font-extrabold leading-none text-white active:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40',
  shelfAxisButtonOn:
    'border-emerald-500 bg-[#14532d] text-white shadow-none',
  shelfAxisLineFirst: 'border-l-2 border-l-amber-700 pl-0.5',

  shelfListShell:
    'flex min-h-0 flex-1 flex-col rounded-lg border-2 border-amber-800 bg-black p-2',
  shelfChipGrid: 'grid max-h-[min(40vh,240px)] grid-cols-3 sm:grid-cols-4 gap-1.5 overflow-y-auto',
  shelfChipButton:
    'inline-flex h-auto min-h-[2.75rem] w-full flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-amber-700 bg-[#292000] px-1 py-1 text-center text-sm font-extrabold leading-tight text-white active:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 sm:text-base',
  shelfChipButtonOn: 'border-emerald-500 bg-[#14532d] text-white',
  shelfChipPrefix:
    'max-w-full break-words text-[clamp(13px,3.6vw,16px)] font-extrabold tracking-wide',
  shelfChipNum:
    'flex-shrink-0 text-[clamp(14px,3.8vw,18px)] font-extrabold tabular-nums tracking-wide',

  shelfUnstructuredLabel:
    'mb-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500',
  shelfUnstructuredChip:
    'min-h-9 rounded-md border-2 border-amber-700/80 bg-[#292000] px-2 text-xs font-bold active:bg-amber-500/15',
  shelfUnstructuredChipOn: 'border-emerald-500 bg-[#14532d] text-white',

  /** 下半: teal（製造order・分配）パネル */
  orderPanelRoot:
    'flex shrink-0 flex-col gap-2.5 rounded-[10px] border-l-4 border-l-teal-400 bg-[#001a18] px-2.5 py-2.5',
  orderInputRow: 'flex w-full min-w-0 flex-nowrap items-stretch gap-1',
  orderInput:
    'box-border h-12 min-h-12 w-[calc(10ch+1.35rem)] max-w-[calc(100%-3.25rem)] flex-shrink-0 rounded-md border-2 border-teal-500 bg-black px-[0.45rem] text-[1.875rem] font-normal leading-[1.15] text-white tabular-nums placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50',

  orderIntentRow:
    'flex flex-wrap items-center justify-start gap-2 border-t-2 border-teal-900 pt-2.5',
  orderIntentButton:
    'inline-flex h-11 min-h-11 w-fit max-w-full shrink-0 items-center justify-center rounded-lg border-2 border-teal-600 bg-[#042f2e] px-3 text-[15px] font-extrabold tracking-wide text-white active:bg-teal-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40',
  orderIntentButtonOn: 'border-emerald-500 bg-[#14532d] text-white',
  orderSubmitButton:
    'inline-flex h-11 min-h-11 w-fit max-w-full shrink-0 items-center justify-center rounded-md border-2 border-teal-300 bg-[#0f766e] px-3 text-[15px] font-extrabold tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/50',

  branchPickLabel:
    'text-xs font-bold uppercase tracking-widest text-neutral-400',
  branchChipWrap: 'flex max-h-[min(28vh,200px)] flex-wrap gap-1.5 overflow-y-auto',
  branchChipButton:
    'flex h-10 min-h-10 max-h-10 min-w-[7rem] w-auto flex-col items-start justify-center gap-0.5 rounded-lg border-2 border-teal-600 bg-[#042f2e] px-2 py-0.5 text-left active:bg-teal-500/15',
  branchChipButtonOn: 'border-emerald-500 bg-[#14532d] text-white',
  branchChipSub:
    'text-[clamp(11px,2.6vw,13px)] font-bold leading-none text-neutral-400',
  branchChipSubOn: 'text-neutral-200',
  branchChipMain:
    'max-w-full truncate whitespace-nowrap text-[clamp(13px,3.6vw,16px)] font-extrabold leading-tight tabular-nums text-white',
} as const;
