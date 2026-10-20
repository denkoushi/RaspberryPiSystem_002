import { useCallback, useMemo, useState } from 'react';

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

  // 呼び出し側の useEffect の依存に入るため、描画ごとに作り直さない（作り直すと再描画が止まらなくなる）
  const setDeviceStatus = useCallback((deviceScopeKey: string, status: DeviceCardStatus) => {
    setStatusMap((prev) => (prev[deviceScopeKey] === status ? prev : { ...prev, [deviceScopeKey]: status }));
  }, []);

  const clearDeviceStatus = useCallback((deviceScopeKey: string) => {
    setStatusMap((prev) => (prev[deviceScopeKey] === 'idle' ? prev : { ...prev, [deviceScopeKey]: 'idle' }));
  }, []);

  return {
    activeDeviceScopeKey,
    setActiveDeviceScopeKey,
    statusMap: normalizedStatusMap,
    setDeviceStatus,
    clearDeviceStatus
  };
}
