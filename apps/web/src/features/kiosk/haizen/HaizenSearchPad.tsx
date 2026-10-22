import { useRef, useState } from 'react';

import { Dialog } from '../../../components/ui/Dialog';
import { invButton, invField, invSeg } from '../inventory/inventoryUi';

import { HaizenKeypad } from './HaizenKeypad';
import { normalizeHaizenSearch, searchKinds, searchValue } from './haizenSearch';

import type { HaizenSearch, HaizenSearchKind } from './haizenSearch';
import type { HaizenOverviewRow } from '../../../api/domains/mobile-placement';

export function HaizenSearchPad({ rows, onSearch, onClose }: { rows: HaizenOverviewRow[]; onSearch: (query: HaizenSearch) => void; onClose: () => void }) {
  const [kind, setKind] = useState<HaizenSearchKind>('fseiban');
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const candidates = [...new Set(rows.map(row => searchValue(row, kind)).filter(Boolean))]
    .filter(value => normalizeHaizenSearch(value).includes(normalizeHaizenSearch(input))).slice(0, 6);
  return <Dialog isOpen onClose={onClose} ariaLabel="番号で探す" initialFocusRef={inputRef}
    overlayClassName="!justify-end !bg-transparent pt-20 pr-7" className="!my-0 !max-w-[460px] !rounded-[18px] !border-inv-line2 !bg-inv-s2 !text-inv-text [color-scheme:dark]">
    <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); if (normalizeHaizenSearch(input)) onSearch({ kind, text: input.trim() }); }}>
      <div role="group" aria-label="検索する番号の種類" className="grid grid-cols-3 gap-1.5">
        {(Object.entries(searchKinds) as [HaizenSearchKind, string][]).map(([key, label]) => <button type="button" key={key} aria-pressed={kind === key} className={invSeg(kind === key)} onClick={() => { setKind(key); setInput(''); }}>{label}</button>)}
      </div>
      <input ref={inputRef} aria-label={`${searchKinds[kind]}を入力`} className={`${invField} h-14 font-mono text-2xl`} value={input} maxLength={100} onChange={event => setInput(event.target.value)} placeholder={`${searchKinds[kind]}（一部だけでも可）`} />
      <HaizenKeypad ariaLabel="番号入力キー" onKey={key => setInput(value => (value + key).slice(0, 100))} onBackspace={() => setInput(value => value.slice(0, -1))} onClear={() => setInput('')} onConfirm={() => onSearch({ kind, text: input.trim() })} confirmDisabled={!normalizeHaizenSearch(input)} onClose={onClose} />
      <div className="flex flex-wrap gap-2" aria-label="候補"><span className="self-center text-sm text-inv-muted">候補</span>{candidates.map(value => <button type="button" key={value} className={`${invButton} max-w-full truncate rounded-full font-mono`} onClick={() => onSearch({ kind, text: value })}>{value}</button>)}</div>
    </form>
  </Dialog>;
}
