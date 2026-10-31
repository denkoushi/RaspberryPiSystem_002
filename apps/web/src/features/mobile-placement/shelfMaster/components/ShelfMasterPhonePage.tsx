import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { HaizenHeader } from '../../haizen/HaizenHeader';
import { HaizenIcon } from '../../haizen/HaizenIcon';
import { isMobilePlacementShelfRegisterRouteState } from '../../shelfSelection';
import { haizenPhoneStyle, hp } from '../../ui/haizenPhoneTokens';

import { ShelfPhotoMaster } from './ShelfPhotoMaster';

export function ShelfMasterPhonePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const backToHub = () => navigate('/kiosk/mobile-placement', {
    state: isMobilePlacementShelfRegisterRouteState(location.state) ? location.state : undefined,
  });

  return <div className={hp.screen} style={haizenPhoneStyle}><div className={hp.content}>
    <HaizenHeader title="棚マスタ" onBack={backToHub} />
    <ShelfPhotoMaster onMessage={setToast} />
    {toast && <div role="status" className="pointer-events-none absolute bottom-24 left-3.5 right-3.5 z-20 flex items-center gap-2.5 rounded-[14px] bg-[var(--hp-ink)] px-4 py-[13px] text-[15px] font-black text-[var(--hp-bg)]"><HaizenIcon name="check" /><span className="break-words">{toast}</span></div>}
  </div></div>;
}
