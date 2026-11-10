import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { HaizenHub } from '../../features/mobile-placement/haizen/HaizenHub';
import { haizenTabNavigationOptions, useHubBackGuard } from '../../features/mobile-placement/haizen/useHubBackGuard';
import { isHaizenNativeAvailable } from '../../features/mobile-placement/haizenNative';
import { isMobilePlacementShelfRegisterRouteState } from '../../features/mobile-placement/shelfSelection';
import { useIsPhoneViewport } from '../../features/mobile-placement/ui/useIsPhoneViewport';
import { useMobilePlacementPageState } from '../../features/mobile-placement/useMobilePlacementPageState';
import { useOrderPlacementBranches } from '../../features/mobile-placement/useOrderPlacementBranches';
import { useRegisteredShelves } from '../../features/mobile-placement/useRegisteredShelves';

import type { HaizenHubSheet } from '../../features/mobile-placement/haizen/HaizenHub';

export function MobilePlacementPage() {
  const mp = useMobilePlacementPageState();
  const [sheet, setSheet] = useState<HaizenHubSheet>(null);
  const isPhone = useIsPhoneViewport();
  useHubBackGuard(isPhone, mp.scanField !== null
    ? () => mp.setScanField(null)
    : sheet !== null ? () => setSheet(null) : null);
  const registeredShelvesQuery = useRegisteredShelves();
  const orderBranchesQuery = useOrderPlacementBranches(mp.orderBarcode);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const restoreShelf = isMobilePlacementShelfRegisterRouteState(location.state);
    const openMenu = location.state?.openHaizenMenu === true;
    if (!restoreShelf && !openMenu) return;
    if (restoreShelf) mp.restoreShelfRegisterRouteState(location.state);
    if (openMenu) setSheet('menu');
    navigate(location.pathname, { replace: true, state: undefined });
    // mp の restore 関数のみ使用（安定）。location を依存に含め戻り state を一度だけ反映する。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mp 全体を入れると再実行が増える
  }, [location.state, location.pathname, mp.restoreShelfRegisterRouteState, navigate]);

  return (
    <div className="flex min-h-0 w-full flex-col">
      <HaizenHub
        mp={mp}
        sheet={sheet}
        setSheet={setSheet}
        shelves={registeredShelvesQuery}
        branches={orderBranchesQuery}
        onNavigate={(path) => navigate(path, path === '/kiosk/purchase-order-lookup' || path === '/kiosk/mobile-placement/part-search'
          ? haizenTabNavigationOptions() : undefined)}
        onShelfMaster={() => navigate('/kiosk/mobile-placement/shelf-master', {
          state: mp.buildShelfRegisterRouteState()
        })}
        onPhoto={isHaizenNativeAvailable() ? () => { void mp.scanActualSlipNative(); } : undefined}
      />
    </div>
  );
}
