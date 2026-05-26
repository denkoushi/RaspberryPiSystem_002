import {
  DEFAULT_MAC_TARGET_SITES,
  PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY,
  PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY
} from './useProductionScheduleMacDeviceScope';

export function LoadBalancingMacProxyPanel(props: {
  macManualOrderV2: boolean;
  macTargetSite: string;
  setMacTargetSite: (value: string) => void;
  macTargetDevice: string;
  setMacTargetDevice: (value: string) => void;
  deviceScopeKeys: string[];
}) {
  if (!props.macManualOrderV2) return null;

  return (
    <div className="mt-3 grid gap-2 rounded-md border border-white/15 bg-slate-950/40 p-3 text-xs text-white/80">
      <p className="font-semibold text-amber-200">Mac 代理参照（device scope v2）</p>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-white/70">工場サイト</span>
        <select
          value={props.macTargetSite}
          onChange={(event) => {
            const next = event.target.value;
            props.setMacTargetSite(next);
            window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY, next);
            window.localStorage.removeItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY);
            props.setMacTargetDevice('');
          }}
          className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
        >
          {DEFAULT_MAC_TARGET_SITES.map((site) => (
            <option key={site} value={site}>
              {site}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-white/70">対象端末スコープ</span>
        <select
          value={props.macTargetDevice}
          onChange={(event) => {
            const next = event.target.value;
            props.setMacTargetDevice(next);
            window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY, next);
          }}
          className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
        >
          {props.deviceScopeKeys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
      {props.macTargetDevice.trim().length === 0 ? (
        <p className="text-[11px] font-semibold text-rose-200">対象端末スコープを選択してください。</p>
      ) : null}
    </div>
  );
}
