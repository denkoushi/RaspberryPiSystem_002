import { useState } from 'react';

import { LoadBalancingMachineMonthlyTab } from '../../features/kiosk/loadBalancing/LoadBalancingMachineMonthlyTab';
import { LoadBalancingMacProxyPanel } from '../../features/kiosk/loadBalancing/LoadBalancingMacProxyPanel';
import { LoadBalancingOverviewTab } from '../../features/kiosk/loadBalancing/LoadBalancingOverviewTab';
import { useProductionScheduleMacDeviceScope } from '../../features/kiosk/loadBalancing/useProductionScheduleMacDeviceScope';

type LoadBalancingView = 'overview' | 'machine-monthly';

export function ProductionScheduleLoadBalancingPage() {
  const [view, setView] = useState<LoadBalancingView>('overview');
  const macScope = useProductionScheduleMacDeviceScope();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-1">
      <section className="rounded-lg border border-white/20 bg-slate-900/60 p-3 text-white">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">負荷調整（山崩し支援）</h2>
          <div className="ml-auto flex flex-wrap gap-1">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                view === 'overview' ? 'bg-fuchsia-700 text-white' : 'bg-slate-800 text-white/80'
              }`}
              aria-selected={view === 'overview'}
              onClick={() => setView('overview')}
            >
              資源CD俯瞰
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                view === 'machine-monthly' ? 'bg-fuchsia-700 text-white' : 'bg-slate-800 text-white/80'
              }`}
              aria-selected={view === 'machine-monthly'}
              onClick={() => setView('machine-monthly')}
            >
              機種別月次負荷
            </button>
          </div>
        </div>

        <LoadBalancingMacProxyPanel
          macManualOrderV2={macScope.macManualOrderV2}
          macTargetSite={macScope.macTargetSite}
          setMacTargetSite={macScope.setMacTargetSite}
          macTargetDevice={macScope.macTargetDevice}
          setMacTargetDevice={macScope.setMacTargetDevice}
          deviceScopeKeys={macScope.macSiteDevicesQuery.data?.deviceScopeKeys ?? []}
        />
      </section>

      {view === 'overview' ? (
        <LoadBalancingOverviewTab scopeParams={macScope.scopeParams} scopeEnabled={macScope.scopeEnabled} />
      ) : (
        <LoadBalancingMachineMonthlyTab scopeParams={macScope.scopeParams} scopeEnabled={macScope.scopeEnabled} />
      )}
    </div>
  );
}
