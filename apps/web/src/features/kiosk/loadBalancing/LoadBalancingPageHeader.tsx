import { LoadBalancingMacProxyPanel } from './LoadBalancingMacProxyPanel';

import type { ReactNode } from 'react';

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
  macProxy?: MacProxyProps;
  children?: ReactNode;
};

const AXIS_NOTE =
  '負荷＝未完了工程の所要時間を 着手日〜納期 の稼働日に日割り。今日より前の分は今日以降へ、納期を過ぎた分は「遅れ」列へ。生産システムの負荷グラフとは集計の仕方が違うため一致しません。';

export function LoadBalancingPageHeader({ macProxy, children }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 rounded-[10px] border border-white/15 bg-slate-900/70 px-3">
      <h1 className="mr-1 text-xl font-extrabold">負荷調整</h1>
      {children}
      <details className="relative ml-auto">
        <summary
          className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-lg bg-slate-800 font-extrabold [&::-webkit-details-marker]:hidden"
          aria-label="集計の説明"
        >
          ⓘ
        </summary>
        <p className="absolute right-0 top-12 z-20 w-96 rounded-lg border border-white/15 bg-slate-950 p-3 text-sm text-white/70 shadow-xl">
          {AXIS_NOTE}
        </p>
      </details>
      {macProxy?.macManualOrderV2 ? (
        <details className="relative">
          <summary
            className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-lg bg-slate-700 font-black [&::-webkit-details-marker]:hidden"
            aria-label="対象絞込を表示"
          >
            V
          </summary>
          <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[min(760px,calc(100vw-24px))] rounded-[10px] border border-white/15 bg-slate-900/95 p-3 shadow-xl">
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
    </header>
  );
}
