import clsx from 'clsx';

import type { ReactNode } from 'react';

export type ProcedureManualPageRailProps = {
  listOpen?: boolean;
  onToggleList?: () => void;
  twoPages?: boolean;
  onToggleTwoPages?: () => void;
  storyboardOpen?: boolean;
  onToggleStoryboard?: () => void;
  fitMode?: 'contain' | 'width';
  onFit?: (mode: 'contain' | 'width') => void;
  fitDisabled?: boolean;
  index?: number;
  total?: number;
  onPrevious?: () => void;
  onNext?: () => void;
};

export function ProcedureManualPageRail({ listOpen = false, onToggleList, twoPages = false, onToggleTwoPages, storyboardOpen = false, onToggleStoryboard, fitMode = 'contain', onFit, fitDisabled = false, index = 0, total = 0, onPrevious, onNext }: ProcedureManualPageRailProps) {
  const button = (label: string, icon: ReactNode, onClick?: () => void, pressed?: boolean, disabled = false, primary = false) => <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled || !onClick} onClick={onClick} className={clsx('grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-[10px] border disabled:opacity-35', pressed || primary ? 'border-[#3ba776] bg-[#3ba776] text-[#0b1a12]' : 'border-[#344252] bg-transparent text-[#eef3f6]')}><svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={label === '前手順' || label === '次手順' ? 2.4 : 2.2}>{icon}</svg></button>;
  const separator = <span aria-hidden="true" className="my-1 h-px w-9 shrink-0 bg-[#344252]" />;
  return <div role="toolbar" aria-label="ページ操作" className="absolute bottom-0 right-0 top-0 flex w-16 flex-col items-center gap-2 overflow-y-auto border-l border-[#27313b] bg-[#161c22] py-2.5">
    {button('一覧を開閉', <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>, onToggleList, listOpen)}
    {button('2 ページ表示', <><rect x="3" y="5" width="8" height="14" rx="1" /><rect x="13" y="5" width="8" height="14" rx="1" /></>, onToggleTwoPages, twoPages, listOpen || total === 0)}
    {separator}
    {button('全手順', <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></>, onToggleStoryboard, storyboardOpen)}
    {button('全体', <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />, onFit ? () => onFit('contain') : undefined, fitMode === 'contain', fitDisabled)}
    {button('幅いっぱい', <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />, onFit ? () => onFit('width') : undefined, fitMode === 'width', fitDisabled)}
    {separator}
    {button('前手順', <path d="M15 5l-7 7 7 7" />, onPrevious, undefined, index === 0)}
    <span role="status" aria-live="polite" aria-label="ページ番号" className="text-center font-mono text-[17px] leading-[1.1]">{total ? index + 1 : 0}<br />/{total}</span>
    {button('次手順', <path d="M9 5l7 7-7 7" />, onNext, undefined, index + (twoPages ? 2 : 1) >= total, true)}
  </div>;
}
