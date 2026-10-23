import { hp } from '../ui/haizenPhoneTokens';

import type { ReactNode } from 'react';

/** Shared with the hub; a back affordance is added only on sub-screens. */
export function HaizenHeader({ title, onBack, children }: {
  title: string; onBack?: () => void; children?: ReactNode;
}) {
  return <header className="flex h-[52px] shrink-0 items-center gap-2.5 px-4 pb-1.5 pt-3.5">
    {onBack && <button type="button" aria-label="戻る" className={hp.iconButton} onClick={onBack}>
      <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 5l-7 7 7 7" /></svg>
    </button>}
    <h1 className="shrink-0 text-[19px] font-black tracking-[.12em]">{title}</h1>
    {children}
  </header>;
}
