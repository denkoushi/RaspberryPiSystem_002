import clsx from 'clsx';

import { HoverRevealCollapsibleToolbar } from '../HoverRevealCollapsibleToolbar';

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
    <HoverRevealCollapsibleToolbar
      title={title}
      statusMessage={statusMessage}
      expanded={expanded}
      onTriggerEnter={onTriggerEnter}
      onPanelMouseEnter={onPanelMouseEnter}
      onPanelMouseLeave={onPanelMouseLeave}
      ariaRegionLabel="生産スケジュールの検索と資源フィルタ"
      triggerTitle={triggerTitle}
      titleClassName="text-xs font-semibold text-amber-200"
      statusMessageClassName="text-xs text-amber-200"
      triggerButtonClassName={clsx(
        'flex min-h-10 min-w-10 shrink-0 cursor-default items-center justify-center rounded border border-white/15',
        'text-amber-200/90 hover:border-amber-200/40 hover:bg-white/5'
      )}
    >
      {children}
    </HoverRevealCollapsibleToolbar>
  );
}
