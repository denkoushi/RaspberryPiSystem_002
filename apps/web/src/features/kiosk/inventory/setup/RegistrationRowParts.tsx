import { invButtonSm, invPanel } from '../inventoryUi';

import { QUANTITY_MAX_DIGITS } from './registrationDraft';

import type { ReactNode } from 'react';

// Fixed, content-sized controls: never stretched to the screen.
const keyClass = 'h-11 w-12 rounded-lg border border-inv-line2 bg-inv-s2 text-[17px] font-black text-inv-text hover:bg-inv-s3';
export const iconSm = `${invButtonSm} w-11 px-0`;

export function StepMark({ number, done, current }: { number: number; done: boolean; current: boolean }) {
  if (done) return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-inv-green text-inv-green-ink" aria-label="完了">✓</span>;
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black ${current ? 'border-inv-amber text-inv-amber' : 'border-inv-line2 text-inv-faint'}`} aria-hidden="true">
      {number}
    </span>
  );
}

export function Row({ id, number, title, done, current, aside, children, bounded = false }: { id: string; number: number; title: string; done: boolean; current: boolean; aside?: ReactNode; children: ReactNode; bounded?: boolean }) {
  return (
    <section id={`registration-${id}`} aria-label={title} className={`${invPanel} flex min-w-0 flex-col gap-2 p-3 ${bounded ? 'min-h-0 flex-1' : 'shrink-0'}`}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StepMark number={number} done={done} current={current} />
          <h3 className="text-[15px] font-black">{title}</h3>
        </div>
        {aside}
      </div>
      <div className={`min-w-0 ${bounded ? 'flex min-h-0 flex-1 flex-col gap-2' : ''}`}>{children}</div>
    </section>
  );
}

export function QuantityKeypad({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const press = (digit: string) => {
    if (value.length >= QUANTITY_MAX_DIGITS) return;
    onChange(`${value}${digit}`.replace(/^0+(?=\d)/, ''));
  };
  return (
    <div role="group" aria-label="最初の数のテンキー" className="grid grid-cols-[repeat(6,48px)] gap-1.5">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'].map((digit) => (
        <button key={digit} type="button" className={keyClass} onClick={() => press(digit)}>{digit}</button>
      ))}
      <button type="button" className={`${keyClass} text-[13px] font-bold text-inv-muted`} onClick={() => onChange(value.slice(0, -1))}>削除</button>
      <button type="button" className={`${keyClass} text-[13px] font-bold text-inv-muted`} onClick={() => onChange('')}>クリア</button>
    </div>
  );
}

