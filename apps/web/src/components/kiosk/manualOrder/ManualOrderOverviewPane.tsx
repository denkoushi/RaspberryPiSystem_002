import { useMemo } from 'react';

import { ManualOrderDeviceCard } from './ManualOrderDeviceCard';

import type { ManualOrderOverviewDeviceCard } from '../../../features/kiosk/productionSchedule/useManualOrderPageController';

type Props = {
  devices: ManualOrderOverviewDeviceCard[];
  activeDeviceScopeKey: string;
  statusMap: Record<string, 'idle' | 'saving' | 'error'>;
  onSelectDevice: (deviceScopeKey: string) => void;
  isLoading: boolean;
  isError: boolean;
};

export function ManualOrderOverviewPane({
  devices,
  activeDeviceScopeKey,
  statusMap,
  onSelectDevice,
  isLoading,
  isError
}: Props) {
  const hasActive = activeDeviceScopeKey.trim().length > 0;
  const emptyMessage = useMemo(() => {
    if (isLoading) return '上ペインを読み込み中…';
    if (isError) return '上ペインの取得に失敗しました。';
    return '表示できる端末がありません。';
  }, [isError, isLoading]);

  return (
    <section className="flex h-full flex-col rounded border border-white/10 bg-slate-900/50 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">全体把握</h2>
        <p className="text-xs text-white/60">{devices.length} 端末</p>
      </div>
      {devices.length === 0 ? (
        <p className="rounded bg-slate-800/80 px-3 py-2 text-xs text-white/70">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
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
            />
          ))}
        </div>
      )}
    </section>
  );
}
