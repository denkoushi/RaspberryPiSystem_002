import { useEffect, useMemo, useRef, useState } from 'react';
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
  const suggestedNextBranchNo = useMemo(() => {
    const list = orderBranchesQuery.data?.branches ?? [];
    if (list.length === 0) return 1;
    return Math.max(...list.map((b) => b.branchNo)) + 1;
  }, [orderBranchesQuery.data?.branches]);
  const location = useLocation();
  const navigate = useNavigate();
  const actualSlipFileInputRef = useRef<HTMLInputElement>(null);

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
      <input
        ref={actualSlipFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void mp.parseActualSlipImageFile(f);
          e.target.value = '';
        }}
      />
      <HaizenHub
        mp={mp}
        sheet={sheet}
        setSheet={setSheet}
        shelves={registeredShelvesQuery}
        branches={orderBranchesQuery}
        suggestedNextBranchNo={suggestedNextBranchNo}
        onNavigate={(path) => navigate(path, path === '/kiosk/purchase-order-lookup' || path === '/kiosk/mobile-placement/part-search'
          ? haizenTabNavigationOptions() : undefined)}
        onShelfMaster={() => navigate('/kiosk/mobile-placement/shelf-master', {
          state: mp.buildShelfRegisterRouteState()
        })}
        onPhoto={() => {
          if (isHaizenNativeAvailable()) void mp.scanActualSlipNative();
          else actualSlipFileInputRef.current?.click();
        }}
      />
    </div>
  );
}
