import clsx from 'clsx';

import type { ReactNode } from 'react';

export type HoverRevealCollapsibleToolbarProps = {
  title: string;
  statusMessage: string | null;
  expanded: boolean;
  onTriggerEnter: () => void;
  onPanelMouseEnter: () => void;
  onPanelMouseLeave: () => void;
  /** 折りたたみ領域の accessible name */
  ariaRegionLabel: string;
  /** ホットゾーンのツールチップ（キオスクはマウス前提） */
  triggerTitle?: string;
  children: ReactNode;
  /** ルート要素（タイトル行＋領域を包む） */
  className?: string;
  titleClassName?: string;
  statusMessageClassName?: string;
  triggerButtonClassName?: string;
  /** 展開時の max-height（Tailwind クラス） */
  expandedMaxHeightClassName?: string;
};

const DEFAULT_EXPANDED_MAX_HEIGHT = 'max-h-[min(40rem,90vh)]';

/** スライダー風（ツールバー展開の目印） */
function FilterRevealTriggerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
    </svg>
  );
}

/**
 * キオスク向け: ホットゾーン hover で子を展開するツールバー枠。
 * 開閉状態は呼び出し側（例: useTimedHoverReveal）が所有する。
 */
export function HoverRevealCollapsibleToolbar({
  title,
  statusMessage,
  expanded,
  onTriggerEnter,
  onPanelMouseEnter,
  onPanelMouseLeave,
  ariaRegionLabel,
  triggerTitle,
  children,
  className,
  titleClassName = 'text-xs font-semibold text-white/90',
  statusMessageClassName = 'text-xs text-white/75',
  triggerButtonClassName = clsx(
    'flex min-h-10 min-w-10 shrink-0 cursor-default items-center justify-center rounded border border-white/15',
    'text-white/85 hover:border-teal-200/40 hover:bg-white/5'
  ),
  expandedMaxHeightClassName = DEFAULT_EXPANDED_MAX_HEIGHT,
}: HoverRevealCollapsibleToolbarProps) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <p className={clsx('shrink-0', titleClassName)}>{title}</p>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {statusMessage ? (
            <span className={statusMessageClassName}>{statusMessage}</span>
          ) : null}
        </div>
        <div
          className={triggerButtonClassName}
          onMouseEnter={onTriggerEnter}
          title={triggerTitle}
        >
          <FilterRevealTriggerIcon />
        </div>
      </div>

      <div
        role="region"
        aria-label={ariaRegionLabel}
        className={clsx(
          'overflow-hidden transition-[max-height] duration-200 ease-out',
          expanded ? expandedMaxHeightClassName : 'max-h-0'
        )}
        aria-expanded={expanded}
      >
        <div onMouseEnter={onPanelMouseEnter} onMouseLeave={onPanelMouseLeave}>
          {children}
        </div>
      </div>
    </div>
  );
}
