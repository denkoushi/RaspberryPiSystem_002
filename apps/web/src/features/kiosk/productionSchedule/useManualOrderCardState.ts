import { useMemo, useState } from 'react';

type DeviceCardStatus = 'idle' | 'saving' | 'error';

export function useManualOrderCardState(deviceScopeKeys: string[]) {
  const [activeDeviceScopeKey, setActiveDeviceScopeKey] = useState('');
  const [statusMap, setStatusMap] = useState<Record<string, DeviceCardStatus>>({});

  const normalizedStatusMap = useMemo(() => {
    const next: Record<string, DeviceCardStatus> = {};
    deviceScopeKeys.forEach((key) => {
      next[key] = statusMap[key] ?? 'idle';
    });
    return next;
  }, [deviceScopeKeys, statusMap]);

  const setDeviceStatus = (deviceScopeKey: string, status: DeviceCardStatus) => {
    setStatusMap((prev) => ({ ...prev, [deviceScopeKey]: status }));
  };

  const clearDeviceStatus = (deviceScopeKey: string) => {
    setStatusMap((prev) => ({ ...prev, [deviceScopeKey]: 'idle' }));
  };

  return {
    activeDeviceScopeKey,
    setActiveDeviceScopeKey,
    statusMap: normalizedStatusMap,
    setDeviceStatus,
    clearDeviceStatus
  };
}
