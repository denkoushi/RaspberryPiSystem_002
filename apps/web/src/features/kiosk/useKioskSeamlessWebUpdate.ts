import { useEffect, useRef } from 'react';

import { readProductionBuildConfig } from '../../config/productionBuildConfig';

import { scheduleKioskPreload, startBrowserKioskWebUpdate } from './browserKioskSeamlessUpdate';
import { startKioskLazyPreload } from './kioskLazyPreload';
import { isKioskPath } from './kioskSeamlessUpdate';

export function useKioskSeamlessWebUpdate(pathname: string, isMaintenance: boolean) {
  const maintenanceRef = useRef(isMaintenance);
  maintenanceRef.current = isMaintenance;
  const isKiosk = isKioskPath(pathname);
  const { isDevelopment } = readProductionBuildConfig();

  useEffect(() => {
    if (!isKiosk || isDevelopment || isMaintenance) return;
    return startKioskLazyPreload(window.location.pathname, isDevelopment, scheduleKioskPreload);
  }, [isKiosk, isDevelopment, isMaintenance]);

  useEffect(() => {
    if (!isKiosk || isDevelopment) return;
    return startBrowserKioskWebUpdate(() => maintenanceRef.current);
  }, [isKiosk, isDevelopment]);
}
