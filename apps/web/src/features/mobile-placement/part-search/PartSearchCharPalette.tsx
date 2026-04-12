import clsx from 'clsx';

const GOJUON_ROWS: string[][] = [
  ['あ', 'い', 'う', 'え', 'お'],
  ['か', 'き', 'く', 'け', 'こ'],
  ['さ', 'し', 'す', 'せ', 'そ'],
  ['た', 'ち', 'つ', 'て', 'と'],
  ['な', 'に', 'ぬ', 'ね', 'の'],
  ['は', 'ひ', 'ふ', 'へ', 'ほ'],
  ['ま', 'み', 'む', 'め', 'も'],
  ['や', 'ゆ', 'よ'],
  ['ら', 'り', 'る', 'れ', 'ろ'],
  ['わ', 'を', 'ん']
];

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const PRESETS = ['脚', '足', 'テーブル', 'ボルト', 'アシ'];

const keyClass =
  'min-h-[40px] rounded-lg border border-white/15 bg-slate-800/80 px-1.5 py-2 text-sm font-semibold text-white active:bg-slate-700';

type Props = {
  onAppend: (s: string) => void;
  onBackspace: () => void;
  className?: string;
};

/**
 * 五十音・ABC・プリセットから検索クエリへ追記する（入力方式と結果表示を分離）。
 */
export function PartSearchCharPalette(props: Props) {
  const { onAppend, onBackspace, className } = props;
  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p} type="button" className={clsx(keyClass, 'text-amber-200/95')} onClick={() => onAppend(p)}>
            {p}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1 sm:grid-cols-10">
        {GOJUON_ROWS.flat().map((ch) => (
          <button key={ch} type="button" className={keyClass} onClick={() => onAppend(ch)}>
            {ch}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:grid-cols-13">
        {ABC.map((ch) => (
          <button key={ch} type="button" className={clsx(keyClass, 'text-xs')} onClick={() => onAppend(ch)}>
            {ch}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className={clsx(keyClass, 'flex-1 text-slate-300')} onClick={() => onAppend(' ')}>
          空白
        </button>
        <button type="button" className={clsx(keyClass, 'flex-1 border-rose-400/40 text-rose-200')} onClick={onBackspace}>
          削除
        </button>
      </div>
    </div>
  );
}
