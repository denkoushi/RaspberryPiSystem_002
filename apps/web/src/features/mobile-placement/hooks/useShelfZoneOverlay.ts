import { useCallback, useMemo, useState } from 'react';

import { findZoneById } from '../shelfZones/findZoneById';

import type { ShelfZoneCatalog, ShelfZoneDefinition, ShelfZoneId } from '../shelfZones/shelfZoneTypes';

type UseShelfZoneOverlayResult = {
  activeZone: ShelfZoneDefinition | null;
  openZone: (id: ShelfZoneId) => void;
  closeZone: () => void;
};

/**
 * ゾーン選択オーバーレイの開閉だけを担う（UI コンポーネントから状態ロジックを分離）
 */
export function useShelfZoneOverlay(catalog: ShelfZoneCatalog): UseShelfZoneOverlayResult {
  const [openId, setOpenId] = useState<ShelfZoneId | null>(null);

  const activeZone = useMemo(() => {
    if (openId == null) return null;
    return findZoneById(catalog.zones, openId) ?? null;
  }, [catalog.zones, openId]);

  const openZone = useCallback((id: ShelfZoneId) => {
    setOpenId(id);
  }, []);

  const closeZone = useCallback(() => {
    setOpenId(null);
  }, []);

  return { activeZone, openZone, closeZone };
}
