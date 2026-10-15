import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { invButtonSmGhost, invSurface, invSetupTargets } from '../../features/kiosk/inventory/inventoryUi';
import { InventoryDashboardTab } from '../../features/kiosk/inventory/setup/InventoryDashboardTab';
import { InventoryPinPad } from '../../features/kiosk/inventory/setup/InventoryPinPad';
import { clearSetupPin, readSetupPin, rememberSetupPin, subscribeSetupLock, touchSetupPin } from '../../features/kiosk/inventory/setup/setupPinSession';

export function KioskItemInventoryDashboardPage() {
  const navigate = useNavigate();
  const [accessPassword, setAccessPassword] = useState(readSetupPin);
  useEffect(() => subscribeSetupLock(() => setAccessPassword(null)), []);
  useEffect(() => {
    if (!accessPassword) return;
    touchSetupPin();
  }, [accessPassword]);

  if (!accessPassword) return <InventoryPinPad onUnlocked={(pin) => { rememberSetupPin(pin); setAccessPassword(pin); }} />;

  return (
    <section className={`${invSurface} ${invSetupTargets}`} onClickCapture={touchSetupPin} onPointerDownCapture={touchSetupPin} onKeyDownCapture={touchSetupPin}>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-4 border-b border-inv-line">
        <h1 className="text-[22px] font-black tracking-[0.02em]">集計</h1>
        <span className="rounded-md bg-inv-amber/[0.12] px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] text-inv-amber">解除中</span>
        <button type="button" className={`${invButtonSmGhost} ml-auto`} onClick={clearSetupPin}>ロック</button>
        <Link to="/kiosk/inventory" className={invButtonSmGhost}>在庫操作に戻る</Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <InventoryDashboardTab accessPassword={accessPassword} onEditItems={() => navigate('/kiosk/inventory/settings', { state: { tab: 'items' } })} />
      </div>
    </section>
  );
}
