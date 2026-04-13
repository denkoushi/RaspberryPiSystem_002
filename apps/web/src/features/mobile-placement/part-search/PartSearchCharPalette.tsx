import clsx from 'clsx';

import {
  PART_SEARCH_ABC,
  PART_SEARCH_GOJUON_ROWS,
  PART_SEARCH_PRESETS,
  PART_SEARCH_SPACE_KEY
} from './partSearchPaletteDefinition';

const keyClass =
  'min-h-[40px] rounded-lg border border-white/15 bg-slate-800/80 px-1.5 py-2 text-sm font-semibold text-white active:bg-slate-700';

type Props = {
  onAppend: (s: string) => void;
  onBackspace: () => void;
  /** 非表示にする文字キー（剪定）。削除ボタンは常に表示。 */
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
  const { onAppend, onBackspace, hiddenKeys, className } = props;
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
      <div className="flex gap-2">
        {isHidden(hiddenKeys, PART_SEARCH_SPACE_KEY) ? null : (
          <button
            type="button"
            className={clsx(keyClass, 'flex-1 text-slate-300')}
            onClick={() => onAppend(PART_SEARCH_SPACE_KEY)}
          >
            空白
          </button>
        )}
        <button
          type="button"
          className={clsx(
            keyClass,
            'border-rose-400/40 text-rose-200',
            isHidden(hiddenKeys, PART_SEARCH_SPACE_KEY) ? 'w-full' : 'flex-1'
          )}
          onClick={onBackspace}
        >
          削除
        </button>
      </div>
    </div>
  );
}
