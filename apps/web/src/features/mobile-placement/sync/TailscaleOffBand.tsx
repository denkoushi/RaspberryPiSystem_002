import { useLayoutEffect } from 'react';

import { haizenPhoneColors } from '../ui/haizenPhoneTokens';

import { useServerUnreachableOnWifi } from './networkGate';

const BAND_HEIGHT = '40px';

export function TailscaleOffBand() {
  const shown = useServerUnreachableOnWifi();
  useLayoutEffect(() => {
    if (!shown) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--mobile-top-band', BAND_HEIGHT);
    return () => { root.style.removeProperty('--mobile-top-band'); };
  }, [shown]);
  if (!shown) return null;
  return <div role="status" style={{ height: BAND_HEIGHT, background: haizenPhoneColors.ng, color: haizenPhoneColors.bg }} className="fixed inset-x-0 top-0 z-50 flex items-center justify-center text-[17px] font-black tracking-[.04em]">Tailscale オフ</div>;
}
