import { useMemo, useState } from 'react';

import { LoadBalancingMachineMonthlyTab } from '../../features/kiosk/loadBalancing/LoadBalancingMachineMonthlyTab';
import { LoadBalancingMacProxyPanel } from '../../features/kiosk/loadBalancing/LoadBalancingMacProxyPanel';
import { LoadBalancingOverviewTab } from '../../features/kiosk/loadBalancing/LoadBalancingOverviewTab';
import { LoadBalancingStartDateLevelingTab } from '../../features/kiosk/loadBalancing/LoadBalancingStartDateLevelingTab';
import { useProductionScheduleMacDeviceScope } from '../../features/kiosk/loadBalancing/useProductionScheduleMacDeviceScope';

type LoadBalancingView = 'overview' | 'machine-monthly' | 'start-date-leveling';

const TAB_ITEMS: { id: LoadBalancingView; label: string }[] = [
  { id: 'overview', label: '資源CD俯瞰' },
  { id: 'machine-monthly', label: '機種別月次負荷' },
  { id: 'start-date-leveling', label: '着手日・平準化' }
];

export function ProductionScheduleLoadBalancingPage() {
  const [view, setView] = useState<LoadBalancingView>('overview');
  const macScope = useProductionScheduleMacDeviceScope();

  const macContextNote = useMemo(() => {
    if (!macScope.macManualOrderV2) return undefined;
    const device = macScope.macTargetDevice.trim();
    if (!device) return `siteKey: ${macScope.macTargetSite} / scope: （未選択）`;
    return `siteKey: ${macScope.macTargetSite} / scope: ${device}`;
  }, [macScope.macManualOrderV2, macScope.macTargetDevice, macScope.macTargetSite]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-1">
      <section className="rounded-lg border border-white/20 bg-slate-900/60 p-2 text-white">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">負荷調整（山崩し支援）</h2>
          <nav className="ml-auto flex flex-wrap gap-1" role="tablist" aria-label="負荷調整ビュー">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  view === tab.id ? 'bg-fuchsia-700 text-white' : 'bg-slate-800 text-white/80'
                }`}
                onClick={() => setView(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          {macScope.macManualOrderV2 ? (
            <details className="relative">
              <summary
                className="list-none grid h-8 w-8 cursor-pointer place-items-center rounded-md bg-slate-700 text-sm font-black text-white [&::-webkit-details-marker]:hidden"
                aria-label="対象絞込を表示"
              >
                V
              </summary>
              <div className="absolute right-0 top-[38px] z-10 w-[min(760px,calc(100vw_-_24px))] rounded-lg border border-white/15 bg-slate-900/95 p-2 shadow-xl">
                <LoadBalancingMacProxyPanel
                  macManualOrderV2={macScope.macManualOrderV2}
                  macTargetSite={macScope.macTargetSite}
                  setMacTargetSite={macScope.setMacTargetSite}
                  macTargetDevice={macScope.macTargetDevice}
                  setMacTargetDevice={macScope.setMacTargetDevice}
                  deviceScopeKeys={macScope.macSiteDevicesQuery.data?.deviceScopeKeys ?? []}
                  contextNote={macContextNote}
                  layout="dropdown"
                />
              </div>
            </details>
          ) : null}
        </div>
      </section>

      {view === 'overview' ? (
        <LoadBalancingOverviewTab scopeParams={macScope.scopeParams} scopeEnabled={macScope.scopeEnabled} />
      ) : view === 'machine-monthly' ? (
        <LoadBalancingMachineMonthlyTab scopeParams={macScope.scopeParams} scopeEnabled={macScope.scopeEnabled} />
      ) : (
        <LoadBalancingStartDateLevelingTab scopeParams={macScope.scopeParams} scopeEnabled={macScope.scopeEnabled} />
      )}
    </div>
  );
}
