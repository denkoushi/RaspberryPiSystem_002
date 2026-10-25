import { useState } from 'react';

import { hp } from '../ui/haizenPhoneTokens';

import { PART_SEARCH_ABC, PART_SEARCH_DIGITS, PART_SEARCH_GOJUON_ROWS, PART_SEARCH_PRESETS, PART_SEARCH_SPACE_KEY } from './partSearchPaletteDefinition';

export function PartSearchPhoneKeyboard({ hiddenKeys, onAppend, onPreset }: {
  hiddenKeys: ReadonlySet<string>; onAppend: (key: string) => void;
  onPreset: (value: string) => void;
}) {
  const [mode, setMode] = useState<'kana' | 'abc'>('kana');
  const keys = [...(mode === 'kana' ? PART_SEARCH_GOJUON_ROWS.flat() : [...PART_SEARCH_ABC, ...PART_SEARCH_DIGITS]), PART_SEARCH_SPACE_KEY]
    .filter((key) => !hiddenKeys.has(key));
  return <div className="flex shrink-0 flex-col gap-[7px] border-t border-[var(--hp-line)] bg-[var(--hp-panel)] px-2.5 pt-2">
    <div className="flex min-h-[38px] items-center gap-1.5" aria-label="定型語">
      <div className="flex shrink-0 overflow-hidden rounded-xl border border-[var(--hp-line)] bg-[var(--hp-bg)]" role="group" aria-label="文字種">
        {(['kana', 'abc'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
          className="h-9 px-3.5 text-sm font-black text-[var(--hp-ink3)] aria-pressed:bg-[var(--hp-ink)] aria-pressed:text-[var(--hp-bg)]">{value === 'kana' ? 'かな' : '英数'}</button>)}
      </div>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto">
        {PART_SEARCH_PRESETS.filter((key) => !hiddenKeys.has(key)).map((key) => <button key={key} type="button" onClick={() => onPreset(key)}
          className="h-[38px] shrink-0 whitespace-nowrap rounded-[10px] border border-[color-mix(in_srgb,var(--hp-shelf)_40%,var(--hp-line))] bg-[var(--hp-bg)] px-[13px] text-[15px] font-black text-[var(--hp-shelf)]">{key}</button>)}
      </div>
    </div>
    <div className="grid h-[146px] grid-cols-7 content-start gap-[5px] overflow-y-auto" aria-label="文字キー">
      {keys.map((key) => <button key={key} type="button" onClick={() => onAppend(key)}
        className="h-11 rounded-[10px] border border-[var(--hp-line)] bg-[var(--hp-bg)] text-[19px] font-black active:bg-[var(--hp-panel2)]">{key === PART_SEARCH_SPACE_KEY ? '空白' : key}</button>)}
      {!keys.length && <span className={`col-span-7 pt-[46px] text-center text-[13px] font-bold ${hp.faint}`}>1字消して戻す</span>}
    </div>
  </div>;
}
