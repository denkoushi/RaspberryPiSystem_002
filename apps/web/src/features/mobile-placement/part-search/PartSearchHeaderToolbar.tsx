export type PartSearchHeaderToolbarProps = {
  title: string;
  showSpaceButton: boolean;
  onSpace: () => void;
  onDelete: () => void;
  onBack: () => void;
};

const actionBtnBase =
  'inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold active:bg-slate-700';

/**
 * タイトルとパレット系ショートカット（空白・削除）・戻る。ルーティング知識を持たない。
 */
export function PartSearchHeaderToolbar(props: PartSearchHeaderToolbarProps) {
  const { title, showSpaceButton, onSpace, onDelete, onBack } = props;

  return (
    <div className="flex min-h-[40px] items-center justify-between gap-2">
      <div className="flex min-h-[40px] min-w-0 flex-1 items-center">
        <h1 className="text-xs font-bold leading-none text-white">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {showSpaceButton ? (
          <button
            type="button"
            aria-label="空白を入力"
            className={`${actionBtnBase} border border-white/15 bg-slate-800/80 text-slate-300`}
            onClick={onSpace}
          >
            空白
          </button>
        ) : null}
        <button
          type="button"
          aria-label="1文字削除"
          className={`${actionBtnBase} border border-rose-400/40 bg-slate-800/80 text-rose-200`}
          onClick={onDelete}
        >
          削除
        </button>
        <button
          type="button"
          aria-label="配膳トップへ戻る"
          className={`${actionBtnBase} shrink-0 border border-white/15 bg-slate-800 text-white`}
          onClick={onBack}
        >
          戻る
        </button>
      </div>
    </div>
  );
}
