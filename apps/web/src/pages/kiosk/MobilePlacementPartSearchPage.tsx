import { useNavigate } from 'react-router-dom';

import { HaizenBottomNav } from '../../features/mobile-placement/haizen/HaizenBottomNav';
import { haizenTabNavigationOptions } from '../../features/mobile-placement/haizen/useHubBackGuard';
import { MobileOfflineChip } from '../../features/mobile-placement/local-data/MobileOfflineChip';
import { useLocalPlacements } from '../../features/mobile-placement/local-data/useLocalPlacements';
import { PartSearchOneHandView } from '../../features/mobile-placement/part-search/onehand/PartSearchOneHandView';
import { haizenPhoneStyle, hp } from '../../features/mobile-placement/ui/haizenPhoneTokens';

export function MobilePlacementPartSearchPage() {
  const navigate = useNavigate();
  const placements = useLocalPlacements();
  return <div style={haizenPhoneStyle} className={hp.screen}>
    <div className={hp.content}>
      <PartSearchOneHandView rows={placements.rows} offline={placements.offline}
        topLeftChip={<MobileOfflineChip offline={placements.offline} updatedAt={placements.updatedAt} />} onDelete={placements.onDelete} />
      <HaizenBottomNav active="parts" onSelect={(tab) => {
        if (tab === 'verify' || tab === 'place') {
          try { localStorage.setItem('haizen-tab', tab); } catch { /* Storage may be disabled on the kiosk. */ }
          navigate('/kiosk/mobile-placement', haizenTabNavigationOptions());
        } else if (tab === 'purchase') navigate('/kiosk/purchase-order-lookup', haizenTabNavigationOptions());
      }} onMenu={() => navigate('/kiosk/mobile-placement', haizenTabNavigationOptions({ openHaizenMenu: true }))} />
    </div>
  </div>;
}
