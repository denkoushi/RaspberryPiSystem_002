import { mpKioskTheme } from '../../mobile-placement/ui/mobilePlacementKioskTheme';

/**
 * 購買照会（FKOBAINO）キオスク専用トークン。
 * 主CTA は配膳メインの sky ボタン（`mpKioskTheme.partSearchButton`）を再利用する。
 */
export const purchaseOrderLookupKioskTheme = {
  primaryButton: mpKioskTheme.partSearchButton,

  backBarWrap: 'shrink-0 border-b border-white/10 bg-slate-900/90 px-3 py-2',

  /** 入力〜結果（左ライム帯・プレビュー HTML 整合） */
  panelRoot:
    'flex min-h-0 flex-1 flex-col gap-3 border-l-4 border-l-lime-400 bg-[#0f1a0a] px-3 py-3',

  orderInput:
    'box-border h-12 min-h-12 min-w-[12rem] flex-1 rounded-md border-2 border-lime-600 bg-black px-2 text-[1.65rem] font-normal tabular-nums text-white placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/40',

  hintAuto: 'text-[0.7rem] leading-snug text-lime-300/90',

  statusLoading: 'min-h-[1.25rem] text-sm text-yellow-200',
  statusErr: 'min-h-[1.25rem] text-sm text-red-200',
  statusOk: 'min-h-[1.25rem] text-sm text-emerald-200',

  resultShell: 'min-h-0 flex-1 overflow-auto rounded-lg border-2 border-zinc-600 bg-black p-2',
  resultList: 'flex flex-col gap-4',
  resultCard:
    'flex flex-col gap-2 rounded-md border border-zinc-600 bg-[#0a0a0a] px-3 py-2.5',
  /** 照会値の主行（プレビュー約 1.56rem） */
  valueLine: 'break-words text-[1.5rem] font-semibold leading-snug text-white md:text-[1.56rem]',
  hinmeiSub: 'mt-1 block text-[0.95rem] font-medium leading-snug text-neutral-400',
  emptyState: 'p-4 text-center text-neutral-400'
} as const;
