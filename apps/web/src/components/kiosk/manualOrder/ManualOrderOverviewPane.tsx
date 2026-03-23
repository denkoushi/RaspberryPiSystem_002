import clsx from 'clsx';
import { useMemo, type ReactNode } from 'react';

import { useToolbarCollapseWhileContentHovered } from '../../../hooks/useToolbarCollapseWhileContentHovered';

import { ManualOrderDeviceCard } from './ManualOrderDeviceCard';
import { ManualOrderPaneHeader } from './ManualOrderPaneHeader';

import type { ManualOrderOverviewDeviceCard } from '../../../features/kiosk/productionSchedule/useManualOrderPageController';

type Props = {
  /** 手動順番見出し・工場選択など（上辺1行の左側クラスタ） */
  siteToolbar: ReactNode;
  devices: ManualOrderOverviewDeviceCard[];
  activeDeviceScopeKey: string;
  statusMap: Record<string, 'idle' | 'saving' | 'error'>;
  onSelectDevice: (deviceScopeKey: string) => void;
  /** deviceScope v2: 資源割り当てモーダル */
  onOpenResourceAssignment?: (deviceScopeKey: string) => void;
  isLoading: boolean;
  isError: boolean;
  /**
   * カード一覧（空状態メッセージ含む）にポインタがある間、`ManualOrderPaneHeader` 行を畳んで縦スペースを確保する。
   * 下ペインの「ホバーで開く」帯とは独立した関心事。
   */
  collapseToolbarWhenContentHovered?: boolean;
  /** 資源CDの表示名（`resourceNameMap` 等）。未指定時は名称なしで2行目は CD·件数のみ */
  resolveResourceDisplayName?: (resourceCd: string) => string;
};

export function ManualOrderOverviewPane({
  siteToolbar,
  devices,
  activeDeviceScopeKey,
  statusMap,
  onSelectDevice,
  onOpenResourceAssignment,
  isLoading,
  isError,
  collapseToolbarWhenContentHovered = true,
  resolveResourceDisplayName
}: Props) {
  const hasActive = activeDeviceScopeKey.trim().length > 0;
  const emptyMessage = useMemo(() => {
    if (isLoading) return '上ペインを読み込み中…';
    if (isError) return '上ペインの取得に失敗しました。';
    return '表示できる端末がありません。';
  }, [isError, isLoading]);

  const toolbarCollapse = useToolbarCollapseWhileContentHovered(collapseToolbarWhenContentHovered);

  return (
    <section className="flex h-full min-h-0 flex-col rounded border border-white/10 bg-slate-900/50 p-2">
      <div
        className={clsx(
          'overflow-hidden transition-[max-height,opacity,margin] duration-200 ease-out',
          toolbarCollapse.toolbarCollapsed
            ? 'pointer-events-none max-h-0 opacity-0'
            : 'max-h-40 opacity-100'
        )}
        aria-hidden={toolbarCollapse.toolbarCollapsed}
      >
        <ManualOrderPaneHeader leading={siteToolbar} deviceCount={devices.length} />
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col"
        onMouseEnter={toolbarCollapse.onContentMouseEnter}
        onMouseLeave={toolbarCollapse.onContentMouseLeave}
      >
        {devices.length === 0 ? (
          <p className="rounded bg-slate-800/80 px-3 py-2 text-xs text-white/70">{emptyMessage}</p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-4 xl:grid-cols-6">
            {devices.map((device) => (
              <ManualOrderDeviceCard
                key={device.deviceScopeKey}
                deviceScopeKey={device.deviceScopeKey}
                label={device.label}
                resources={device.resources}
                isActive={activeDeviceScopeKey === device.deviceScopeKey}
                isDimmed={hasActive && activeDeviceScopeKey !== device.deviceScopeKey}
                status={statusMap[device.deviceScopeKey] ?? 'idle'}
                onSelect={onSelectDevice}
                onOpenResourceAssignment={onOpenResourceAssignment}
                resolveResourceDisplayName={resolveResourceDisplayName}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
