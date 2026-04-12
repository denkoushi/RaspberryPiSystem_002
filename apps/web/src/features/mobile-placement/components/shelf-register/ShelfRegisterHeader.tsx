/**
 * 棚番登録ヘッダー: 戻る・確定（タイトル位置）・選択中プレビュー。
 * ページのナビゲーション／確定は親が保持し、本コンポーネントは表示とイベント通知のみ（単一責任）。
 */
export type ShelfRegisterHeaderProps = {
  previewText: string;
  canConfirm: boolean;
  onBack: () => void;
  onConfirm: () => void;
};

export function ShelfRegisterHeader({ previewText, canConfirm, onBack, onConfirm }: ShelfRegisterHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/20 px-3.5 py-2">
      <button
        type="button"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/30 bg-white/10 text-lg text-white active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
        title="戻る"
        aria-label="戻る"
        onClick={onBack}
      >
        ←
      </button>
      <button
        type="button"
        className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-[10px] border-0 bg-gradient-to-b from-teal-400/50 to-teal-600/35 px-3 py-2 text-sm font-extrabold text-teal-50 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
        disabled={!canConfirm}
        aria-label="この棚番で登録"
        onClick={onConfirm}
      >
        棚番を登録
      </button>
      <div
        className="ml-auto flex min-h-9 min-w-0 max-w-[14rem] flex-1 basis-[8rem] items-center justify-center gap-2 rounded-lg border border-amber-400/50 bg-amber-500/[0.06] px-2 py-1.5"
        aria-live="polite"
        aria-label={`選択中の棚番 ${previewText}`}
      >
        <span className="shrink-0 text-[11px] font-semibold text-slate-400">選択中</span>
        <span className="min-w-0 truncate text-sm font-extrabold tabular-nums tracking-wide text-amber-300">
          {previewText}
        </span>
      </div>
    </header>
  );
}
