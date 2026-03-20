import type { ReactNode } from 'react';

type Props = {
  leading: ReactNode;
  deviceCount: number;
  /** 既定: 全体把握 */
  overviewTitle?: string;
};

export function ManualOrderPaneHeader({
  leading,
  deviceCount,
  overviewTitle = '全体把握'
}: Props) {
  return (
    <div className="mb-1.5 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{leading}</div>
      <span className="select-none text-white/25" aria-hidden>
        |
      </span>
      <h2 className="text-sm font-semibold text-white">{overviewTitle}</h2>
      <p className="text-xs tabular-nums text-white/60">{deviceCount} 端末</p>
    </div>
  );
}
