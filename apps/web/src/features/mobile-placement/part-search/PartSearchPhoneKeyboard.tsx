import { useState } from 'react';

import { hp } from '../ui/haizenPhoneTokens';

import { PART_SEARCH_ABC, PART_SEARCH_DIGITS, PART_SEARCH_GOJUON_ROWS, PART_SEARCH_PRESETS, PART_SEARCH_SPACE_KEY } from './partSearchPaletteDefinition';

export function PartSearchPhoneKeyboard({ hiddenKeys, onAppend, onPreset, onDelete }: {
  hiddenKeys: ReadonlySet<string>; onAppend: (key: string) => void;
  onPreset: (value: string) => void; onDelete: () => void;
}) {
  const [mode, setMode] = useState<'kana' | 'abc'>('kana');
  const keys = [...(mode === 'kana' ? PART_SEARCH_GOJUON_ROWS.flat() : [...PART_SEARCH_ABC, ...PART_SEARCH_DIGITS]), PART_SEARCH_SPACE_KEY]
    .filter((key) => !hiddenKeys.has(key));
  return <div className="flex shrink-0 flex-col gap-[7px] border-t border-[var(--hp-line)] bg-[var(--hp-panel)] px-2.5 pt-2 pb-[calc(10px+env(safe-area-inset-bottom,0px))]">
    <div className="flex min-h-[38px] gap-1.5 overflow-x-auto" aria-label="定型語">
      {PART_SEARCH_PRESETS.filter((key) => !hiddenKeys.has(key)).map((key) => <button key={key} type="button" onClick={() => onPreset(key)}
        className="h-[38px] shrink-0 whitespace-nowrap rounded-[10px] border border-[color-mix(in_srgb,var(--hp-shelf)_40%,var(--hp-line))] bg-[var(--hp-bg)] px-[13px] text-[15px] font-black text-[var(--hp-shelf)]">{key}</button>)}
    </div>
    <div className="grid h-[146px] grid-cols-7 content-start gap-[5px] overflow-y-auto" aria-label="文字キー">
      {keys.map((key) => <button key={key} type="button" onClick={() => onAppend(key)}
        className="h-11 rounded-[10px] border border-[var(--hp-line)] bg-[var(--hp-bg)] text-[19px] font-black active:bg-[var(--hp-panel2)]">{key === PART_SEARCH_SPACE_KEY ? '空白' : key}</button>)}
      {!keys.length && <span className={`col-span-7 pt-[46px] text-center text-[13px] font-bold ${hp.faint}`}>1字消して戻す</span>}
    </div>
    <div className="flex min-h-[calc(var(--hp-hermes-gutter)-10px)] items-end gap-1.5 pr-[calc(var(--hp-hermes-gutter)-10px)]">
      <div className="flex overflow-hidden rounded-xl border border-[var(--hp-line)] bg-[var(--hp-bg)]" role="group" aria-label="文字種">
        {(['kana', 'abc'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
          className="h-[42px] px-3.5 text-sm font-black text-[var(--hp-ink3)] aria-pressed:bg-[var(--hp-ink)] aria-pressed:text-[var(--hp-bg)]">{value === 'kana' ? 'かな' : '英数'}</button>)}
      </div>
      <button type="button" onClick={onDelete} aria-label="1文字消す"
        className="ml-auto flex h-[42px] shrink-0 items-center gap-1.5 rounded-xl border border-[color-mix(in_srgb,var(--hp-ng)_45%,var(--hp-line))] bg-[var(--hp-bg)] px-2 text-sm font-black text-[var(--hp-ng)]">
        <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 5h11v14H9l-6-7zM12.5 9.5l5 5M17.5 9.5l-5 5" /></svg>1字消す
      </button>
    </div>
  </div>;
}
