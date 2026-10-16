import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { invButtonSmGhost, invSurface, invSetupTargets } from '../../features/kiosk/inventory/inventoryUi';
import { InventoryDashboardTab, type InventoryVariantAction } from '../../features/kiosk/inventory/setup/InventoryDashboardTab';
import { InventoryPinPad } from '../../features/kiosk/inventory/setup/InventoryPinPad';
import { clearSetupPin, readSetupPin, rememberSetupPin, subscribeSetupLock, touchSetupPin } from '../../features/kiosk/inventory/setup/setupPinSession';

export function KioskItemInventoryDashboardPage() {
  const navigate = useNavigate();
  const [pendingAction, setPendingAction] = useState<InventoryVariantAction | null>(null);
  const [accessPassword, setAccessPassword] = useState(readSetupPin);
  useEffect(() => subscribeSetupLock(() => setAccessPassword(null)), []);
  useEffect(() => {
    if (!accessPassword) return;
    touchSetupPin();
  }, [accessPassword]);

  if (!accessPassword && pendingAction) return <InventoryPinPad onCancel={() => setPendingAction(null)} onUnlocked={(pin) => { rememberSetupPin(pin); setAccessPassword(pin); }} />;

  return (
    <section className={`${invSurface} ${invSetupTargets}`} onClickCapture={accessPassword ? touchSetupPin : undefined} onPointerDownCapture={accessPassword ? touchSetupPin : undefined} onKeyDownCapture={accessPassword ? touchSetupPin : undefined}>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-4 border-b border-inv-line">
        <h1 className="text-[22px] font-black tracking-[0.02em]">集計</h1>
        {accessPassword && <><span className="rounded-md bg-inv-amber/[0.12] px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] text-inv-amber">解除中</span>
        <button type="button" className={invButtonSmGhost} onClick={clearSetupPin}>ロック</button></>}
        <Link to="/kiosk/inventory" className={`${invButtonSmGhost} ml-auto`}>在庫操作に戻る</Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <InventoryDashboardTab accessPassword={accessPassword ?? undefined} onRequestUnlock={setPendingAction} pendingAction={pendingAction} onActionHandled={() => setPendingAction(null)} onEditItems={() => navigate('/kiosk/inventory/settings', { state: { tab: 'items' } })} />
      </div>
    </section>
  );
}
