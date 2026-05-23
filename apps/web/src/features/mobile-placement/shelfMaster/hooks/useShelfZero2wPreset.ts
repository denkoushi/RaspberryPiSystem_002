import { useCallback, useMemo, useState } from 'react';

import { useAssignZero2wPreset, useHaizenTargetDevicesForShelfMaster } from '../useShelfMasterQueries';
import { appendPendingFromPiSelect, type PendingZero2wPreset } from '../zero2wPreset/pendingZero2wPreset';
import {
  findDeviceIdOnShelf,
  piSelectionRequiresApply,
  type HaizenTargetDeviceOption
} from '../zero2wPreset/zero2wPiSelectOptions';
import {
  ZERO2W_PI_CLEAR,
  ZERO2W_PI_UNCHANGED,
  isZero2wDeviceId,
  type Zero2wPiSelectValue
} from '../zero2wPreset/zero2wPiSelectValue';

type Options = {
  isOpen: boolean;
  onMessage: (message: string | null) => void;
};

export function useShelfZero2wPreset({ isOpen, onMessage }: Options) {
  const devicesQuery = useHaizenTargetDevicesForShelfMaster();
  const assignMutation = useAssignZero2wPreset();

  const [selectedPi, setSelectedPi] = useState<Zero2wPiSelectValue>(ZERO2W_PI_UNCHANGED);
  const [pendingAfterLayoutSave, setPendingAfterLayoutSave] = useState<PendingZero2wPreset[]>([]);

  const devices: HaizenTargetDeviceOption[] = useMemo(
    () =>
      isOpen
        ? (devicesQuery.data?.devices ?? []).map((d) => ({
            id: d.id,
            name: d.name,
            shelfCodeRaw: d.shelfCodeRaw
          }))
        : [],
    [devicesQuery.data?.devices, isOpen]
  );

  const reset = useCallback(() => {
    setSelectedPi(ZERO2W_PI_UNCHANGED);
    setPendingAfterLayoutSave([]);
  }, []);

  const syncPiForShelf = useCallback(
    (shelfCodeRaw: string | null) => {
      if (!shelfCodeRaw) {
        setSelectedPi(ZERO2W_PI_UNCHANGED);
        return;
      }
      const onShelf = findDeviceIdOnShelf(devices, shelfCodeRaw);
      setSelectedPi(onShelf ?? ZERO2W_PI_UNCHANGED);
    },
    [devices]
  );

  const piSelectionNeedsApply = useCallback(
    (targetShelfCodeRaw: string | null) => {
      if (!targetShelfCodeRaw) {
        return false;
      }
      return piSelectionRequiresApply(
        selectedPi,
        findDeviceIdOnShelf(devices, targetShelfCodeRaw)
      );
    },
    [devices, selectedPi]
  );

  const queuePresetAfterAssign = useCallback(
    (shelfCodeRaw: string) => {
      setPendingAfterLayoutSave((queue) => appendPendingFromPiSelect(queue, shelfCodeRaw, selectedPi));
    },
    [selectedPi]
  );

  const applyPresetForExistingShelf = useCallback(
    (shelfCodeRaw: string) => {
      if (selectedPi === ZERO2W_PI_UNCHANGED) {
        return;
      }
      if (selectedPi === ZERO2W_PI_CLEAR) {
        const deviceId = findDeviceIdOnShelf(devices, shelfCodeRaw);
        if (!deviceId) {
          onMessage('この棚に担当 Pi は設定されていません');
          return;
        }
        assignMutation.mutate(
          { clientDeviceId: deviceId, shelfCodeRaw: null },
          {
            onSuccess: () => {
              onMessage('Zero2W 担当棚を解除しました');
              setSelectedPi(ZERO2W_PI_UNCHANGED);
            },
            onError: (e: unknown) =>
              onMessage(e instanceof Error ? e.message : '担当解除に失敗しました')
          }
        );
        return;
      }
      if (!isZero2wDeviceId(selectedPi)) {
        return;
      }
      assignMutation.mutate(
        { clientDeviceId: selectedPi, shelfCodeRaw },
        {
          onSuccess: () => {
            onMessage('Zero2W 担当棚を反映しました');
            syncPiForShelf(shelfCodeRaw);
          },
          onError: (e: unknown) =>
            onMessage(e instanceof Error ? e.message : '担当反映に失敗しました')
        }
      );
    },
    [assignMutation, devices, onMessage, selectedPi, syncPiForShelf]
  );

  const flushPendingPresets = useCallback(async (): Promise<boolean> => {
    if (pendingAfterLayoutSave.length === 0) {
      return false;
    }
    const failures: string[] = [];
    for (const item of pendingAfterLayoutSave) {
      try {
        await assignMutation.mutateAsync({
          clientDeviceId: item.clientDeviceId,
          shelfCodeRaw: item.shelfCodeRaw
        });
      } catch (e: unknown) {
        failures.push(e instanceof Error ? e.message : 'preset の反映に失敗しました');
      }
    }
    setPendingAfterLayoutSave([]);
    if (failures.length > 0) {
      onMessage(
        `レイアウトは保存済みですが、Zero2W 担当棚の一部反映に失敗しました: ${failures[0]}`
      );
      return true;
    }
    onMessage('レイアウトを保存し、Zero2W 担当棚を反映しました');
    return true;
  }, [assignMutation, onMessage, pendingAfterLayoutSave]);

  return {
    devices,
    devicesQuery,
    selectedPi,
    setSelectedPi,
    pendingAfterLayoutSave,
    reset,
    syncPiForShelf,
    queuePresetAfterAssign,
    applyPresetForExistingShelf,
    flushPendingPresets,
    piSelectionNeedsApply,
    presetApplyPending: assignMutation.isPending,
    hasPendingAfterSave: pendingAfterLayoutSave.length > 0
  };
}
