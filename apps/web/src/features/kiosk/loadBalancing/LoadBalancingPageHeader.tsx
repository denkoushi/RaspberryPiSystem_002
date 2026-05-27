import { LoadBalancingMacProxyPanel } from './LoadBalancingMacProxyPanel';
import { lbBtn, lbCard, lbText } from './loadBalancingUiClasses';

import type { ReactNode } from 'react';

export type LoadBalancingViewId = 'overview' | 'machine-monthly' | 'start-date-leveling';

type TabItem = { id: LoadBalancingViewId; label: string };

type MacProxyProps = {
  macManualOrderV2: boolean;
  macTargetSite: string;
  setMacTargetSite: (value: string) => void;
  macTargetDevice: string;
  setMacTargetDevice: (value: string) => void;
  deviceScopeKeys: string[];
  contextNote?: string;
};

type Props = {
  activeView: LoadBalancingViewId;
  tabs: TabItem[];
  onViewChange: (view: LoadBalancingViewId) => void;
  macProxy?: MacProxyProps;
  children?: ReactNode;
};

export function LoadBalancingPageHeader({ activeView, tabs, onViewChange, macProxy, children }: Props) {
  return (
    <header className={lbCard.header}>
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className={lbText.pageTitle}>負荷調整（山崩し支援）</h1>
        <nav className="flex flex-wrap gap-1.5" role="tablist" aria-label="負荷調整ビュー">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeView === tab.id}
              className={activeView === tab.id ? lbBtn.tabActive : lbBtn.tabIdle}
              onClick={() => onViewChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {macProxy?.macManualOrderV2 ? (
          <details className="relative">
            <summary
              className={`${lbBtn.tabV} list-none cursor-pointer [&::-webkit-details-marker]:hidden`}
              aria-label="対象絞込を表示"
            >
              V
            </summary>
            <div className="absolute right-0 top-[calc(100%+6px)] z-10 w-[min(760px,calc(100vw-24px))] rounded-[10px] border border-white/15 bg-slate-900/95 p-3 shadow-xl">
              <LoadBalancingMacProxyPanel
                macManualOrderV2={macProxy.macManualOrderV2}
                macTargetSite={macProxy.macTargetSite}
                setMacTargetSite={macProxy.setMacTargetSite}
                macTargetDevice={macProxy.macTargetDevice}
                setMacTargetDevice={macProxy.setMacTargetDevice}
                deviceScopeKeys={macProxy.deviceScopeKeys}
                contextNote={macProxy.contextNote}
                layout="dropdown"
              />
            </div>
          </details>
        ) : null}
      </div>
      {children}
    </header>
  );
}
