import { useMemo, useState } from 'react';

import { LoadBalancingMachineMonthlyTab } from '../../features/kiosk/loadBalancing/LoadBalancingMachineMonthlyTab';
import { LoadBalancingOverviewTab } from '../../features/kiosk/loadBalancing/LoadBalancingOverviewTab';
import {
  LoadBalancingPageHeader,
  type LoadBalancingViewId
} from '../../features/kiosk/loadBalancing/LoadBalancingPageHeader';
import { LoadBalancingStartDateLevelingTab } from '../../features/kiosk/loadBalancing/LoadBalancingStartDateLevelingTab';
import { lbPage } from '../../features/kiosk/loadBalancing/loadBalancingUiClasses';
import { useProductionScheduleMacDeviceScope } from '../../features/kiosk/loadBalancing/useProductionScheduleMacDeviceScope';

const TAB_ITEMS: { id: LoadBalancingViewId; label: string }[] = [
  { id: 'overview', label: '資源CD俯瞰' },
  { id: 'machine-monthly', label: '機種別月次負荷' },
  { id: 'start-date-leveling', label: '着手日・平準化' }
];

export function ProductionScheduleLoadBalancingPage() {
  const [view, setView] = useState<LoadBalancingViewId>('overview');
  const macScope = useProductionScheduleMacDeviceScope();

  const macContextNote = useMemo(() => {
    if (!macScope.macManualOrderV2) return undefined;
    const device = macScope.macTargetDevice.trim();
    if (!device) return `siteKey: ${macScope.macTargetSite} / scope: （未選択）`;
    return `siteKey: ${macScope.macTargetSite} / scope: ${device}`;
  }, [macScope.macManualOrderV2, macScope.macTargetDevice, macScope.macTargetSite]);

  const macProxy = macScope.macManualOrderV2
    ? {
        macManualOrderV2: macScope.macManualOrderV2,
        macTargetSite: macScope.macTargetSite,
        setMacTargetSite: macScope.setMacTargetSite,
        macTargetDevice: macScope.macTargetDevice,
        setMacTargetDevice: macScope.setMacTargetDevice,
        deviceScopeKeys: macScope.macSiteDevicesQuery.data?.deviceScopeKeys ?? [],
        contextNote: macContextNote
      }
    : undefined;

  return (
    <div className={lbPage.root}>
      <LoadBalancingPageHeader activeView={view} tabs={TAB_ITEMS} onViewChange={setView} macProxy={macProxy} />

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
