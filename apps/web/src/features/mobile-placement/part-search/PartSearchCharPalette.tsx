import clsx from 'clsx';

import {
  PART_SEARCH_ABC,
  PART_SEARCH_DIGITS,
  PART_SEARCH_GOJUON_ROWS,
  PART_SEARCH_PRESETS
} from './partSearchPaletteDefinition';

const keyClass =
  'min-h-[40px] rounded-lg border border-white/15 bg-slate-800/80 px-1.5 py-2 text-sm font-semibold text-white active:bg-slate-700';

type Props = {
  onAppend: (s: string) => void;
  /** 非表示にする文字キー（剪定）。空白ボタンはページヘッダー側で同条件を参照。 */
  hiddenKeys?: ReadonlySet<string>;
  className?: string;
};

function isHidden(hiddenKeys: ReadonlySet<string> | undefined, ch: string): boolean {
  return hiddenKeys?.has(ch) === true;
}

/**
 * 五十音・ABC・プリセットから検索クエリへ追記する（表示と剪定を分離）。
 */
export function PartSearchCharPalette(props: Props) {
  const { onAppend, hiddenKeys, className } = props;
  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {PART_SEARCH_PRESETS.map((p) =>
          isHidden(hiddenKeys, p) ? null : (
            <button key={p} type="button" className={clsx(keyClass, 'text-amber-200/95')} onClick={() => onAppend(p)}>
              {p}
            </button>
          )
        )}
      </div>
      <div className="grid grid-cols-5 gap-1 sm:grid-cols-10">
        {PART_SEARCH_GOJUON_ROWS.flat().map((ch) =>
          isHidden(hiddenKeys, ch) ? null : (
            <button key={ch} type="button" className={keyClass} onClick={() => onAppend(ch)}>
              {ch}
            </button>
          )
        )}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:grid-cols-13">
        {PART_SEARCH_ABC.map((ch) =>
          isHidden(hiddenKeys, ch) ? null : (
            <button key={ch} type="button" className={clsx(keyClass, 'text-xs')} onClick={() => onAppend(ch)}>
              {ch}
            </button>
          )
        )}
      </div>
      <div className="grid grid-cols-5 gap-1 sm:grid-cols-10">
        {PART_SEARCH_DIGITS.map((ch) =>
          isHidden(hiddenKeys, ch) ? null : (
            <button key={ch} type="button" className={clsx(keyClass, 'text-sm')} onClick={() => onAppend(ch)}>
              {ch}
            </button>
          )
        )}
      </div>
    </div>
  );
}
