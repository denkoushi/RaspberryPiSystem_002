import clsx from 'clsx';

import type { ReactNode } from 'react';

export type ManualOrderLowerPaneCollapsibleToolbarProps = {
  title: string;
  statusMessage: string | null;
  expanded: boolean;
  onTriggerEnter: () => void;
  onPanelMouseEnter: () => void;
  onPanelMouseLeave: () => void;
  /** ホットゾーンのツールチップ（キオスクはマウス前提） */
  triggerTitle?: string;
  children: ReactNode;
};

const DEFAULT_TRIGGER_TITLE = 'マウスを乗せて検索バーと資源フィルタを表示';

/** スライダー風（検索・絞り込みの目印） */
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
 * 手動順番下ペイン: ツールバー＋資源帯をホバーで展開する枠。
 * 開閉状態は呼び出し側（例: useTimedHoverReveal）が所有する。
 */
export function ManualOrderLowerPaneCollapsibleToolbar({
  title,
  statusMessage,
  expanded,
  onTriggerEnter,
  onPanelMouseEnter,
  onPanelMouseLeave,
  triggerTitle = DEFAULT_TRIGGER_TITLE,
  children
}: ManualOrderLowerPaneCollapsibleToolbarProps) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="shrink-0 text-xs font-semibold text-amber-200">{title}</p>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {statusMessage ? <span className="text-xs text-amber-200">{statusMessage}</span> : null}
        </div>
        <div
          className={clsx(
            'flex min-h-10 min-w-10 shrink-0 cursor-default items-center justify-center rounded border border-white/15',
            'text-amber-200/90 hover:border-amber-200/40 hover:bg-white/5'
          )}
          onMouseEnter={onTriggerEnter}
          title={triggerTitle}
        >
          <FilterRevealTriggerIcon />
        </div>
      </div>

      <div
        role="region"
        aria-label="生産スケジュールの検索と資源フィルタ"
        className={clsx(
          'overflow-hidden transition-[max-height] duration-200 ease-out',
          expanded ? 'max-h-[min(40rem,90vh)]' : 'max-h-0'
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
