import { useCallback, useState } from 'react';

import { getZero2wAssignmentFlowGates } from '../flow/zero2wAssignmentFlow';
import { useAssignZero2wPreset, useHaizenTargetDevicesForShelfMaster } from '../useShelfMasterQueries';

type Options = {
  isOpen: boolean;
  layoutCellsSelected: boolean;
  onMessage: (message: string | null) => void;
};

export function useZero2wAssignmentState({ isOpen, layoutCellsSelected, onMessage }: Options) {
  const devicesQuery = useHaizenTargetDevicesForShelfMaster();
  const assignMutation = useAssignZero2wPreset();

  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedShelf, setSelectedShelf] = useState('');

  const devices = isOpen ? (devicesQuery.data?.devices ?? []) : [];

  const gates = getZero2wAssignmentFlowGates({
    selectedDeviceId,
    selectedShelf,
    savePending: assignMutation.isPending,
    layoutCellsSelected
  });

  const selectDevice = useCallback((deviceId: string, currentShelf: string) => {
    setSelectedDeviceId((prev) => {
      if (prev === deviceId) {
        setSelectedShelf('');
        return '';
      }
      setSelectedShelf(currentShelf);
      return deviceId;
    });
  }, []);

  const selectShelfFromMap = useCallback((shelfCodeRaw: string) => {
    setSelectedShelf(shelfCodeRaw);
  }, []);

  const reset = useCallback(() => {
    setSelectedDeviceId('');
    setSelectedShelf('');
  }, []);

  const save = useCallback(() => {
    if (!selectedDeviceId || !selectedShelf) return;
    assignMutation.mutate(
      { clientDeviceId: selectedDeviceId, shelfCodeRaw: selectedShelf },
      {
        onSuccess: () => onMessage('Zero2W 担当棚を更新しました'),
        onError: (e: unknown) => onMessage(e instanceof Error ? e.message : '更新に失敗しました')
      }
    );
  }, [assignMutation, onMessage, selectedDeviceId, selectedShelf]);

  return {
    devices,
    devicesQuery,
    selectedDeviceId,
    selectedShelf,
    gates,
    selectDevice,
    selectShelfFromMap,
    reset,
    save,
    savePending: assignMutation.isPending
  };
}
