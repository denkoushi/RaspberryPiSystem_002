import { composeArea, type ShelfDirection } from '@raspi-system/shelf-layout-core';
import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import { deleteMobilePlacementShelf, getMobilePlacementShelfPhoto, patchMobilePlacementShelfMemo, putMobilePlacementShelfPhoto } from '../../../../api/client';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';
import { resizeShelfPhoto, rotateShelfPhoto } from '../../shelfPhoto/resizeShelfPhoto';
import { useShelfMachines } from '../../useShelfMachines';
import { useShelfOfflineQueue } from '../offline/useShelfOfflineQueue';
import { clearShelfPhotoDraft, readShelfPhotoDraft, saveShelfPhotoDraft } from '../shelfPhotoDraft';
import { useAssignZero2wPreset, useHaizenTargetDevicesForShelfMaster } from '../useShelfMasterQueries';
import { findDeviceIdOnShelf, piSelectionRequiresApply } from '../zero2wPreset/zero2wPiSelectOptions';
import { ZERO2W_PI_CLEAR, ZERO2W_PI_UNCHANGED, type Zero2wPiSelectValue } from '../zero2wPreset/zero2wPiSelectValue';

import type { RegisteredShelfEntryDto } from '../../registeredShelves';

export type ShelfPhotoEditorProps = { shelf: RegisteredShelfEntryDto | null; shelves: RegisteredShelfEntryDto[]; machinesQuery: ReturnType<typeof useShelfMachines>; devicesQuery: ReturnType<typeof useHaizenTargetDevicesForShelfMaster>; submit: ReturnType<typeof useShelfOfflineQueue>['submit']; onClose: () => void; onMessage?: (message: string) => void; initial?: { machine: string; direction: ShelfDirection | '' | null; memo?: string } };

export function useShelfPhotoEditor({ shelf, shelves, machinesQuery, devicesQuery, submit, onClose, onMessage, initial }: ShelfPhotoEditorProps) {
  const client = useQueryClient();
  const assignPreset = useAssignZero2wPreset();
  const [zeroSheet, setZeroSheet] = useState(false);
  const [zeroDraft, setZeroDraft] = useState<Zero2wPiSelectValue>(ZERO2W_PI_UNCHANGED);
  const [selectedPi, setSelectedPi] = useState<Zero2wPiSelectValue>(ZERO2W_PI_UNCHANGED);
  const devices = devicesQuery.data?.devices ?? [];
  const currentDeviceId = shelf ? findDeviceIdOnShelf(devices, shelf.shelfCodeRaw) : null;
  const draftDeviceId = zeroDraft === ZERO2W_PI_UNCHANGED ? currentDeviceId : zeroDraft === ZERO2W_PI_CLEAR ? null : zeroDraft;
  const draftDevice = devices.find((device) => device.id === draftDeviceId);
  const input = useRef<HTMLInputElement>(null);
  const [draft] = useState(() => shelf ? null : initial ?? readShelfPhotoDraft());
  const [cameraOpen, setCameraOpen] = useState(false);
  const [machine, setMachine] = useState(draft?.machine ?? '');
  const [landmarkSheet, setLandmarkSheet] = useState(false);
  const [direction, setDirection] = useState<ShelfDirection | '' | null>(draft?.direction ?? null);
  const [memo, setMemo] = useState(shelf?.displayLabel ?? draft?.memo ?? '');
  const [savedMemo, setSavedMemo] = useState(shelf?.displayLabel?.trim() || null);
  const [photo, setPhoto] = useState<Awaited<ReturnType<typeof resizeShelfPhoto>> | null>(null);
  const createdCode = shelf?.shelfCodeRaw ?? null;
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (shelf) return;
    saveShelfPhotoDraft({ machine, direction, memo });
  }, [shelf, machine, direction, memo]);
  const directions = ['北西', '北', '北東', '西', '', '東', '南西', '南', '南東'] as const;
  const registeredDirections = new Set(directions.filter((d) => shelves.some((s) => s.shelfCodeRaw === (d ? composeArea(machine, d) : machine))));
  const code = createdCode ?? (machine && direction !== null ? (direction ? composeArea(machine, direction) : machine) : '');
  const canSave = !busy && Boolean(code) && (Boolean(createdCode) ||
    (Boolean(photo) && direction !== null && !registeredDirections.has(direction) &&
      !machinesQuery.isError && Boolean(machinesQuery.data?.machines.includes(machine) || machinesQuery.data?.landmarks?.includes(machine))));
  const deleteShelf = async () => {
    if (!shelf || busy) return;
    setBusy(true); setError(null);
    try {
      await deleteMobilePlacementShelf(shelf.shelfCodeRaw);
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfLayout });
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.haizenTargetDevices });
      onClose();
      onMessage?.(`${shelf.shelfCodeRaw} を消しました`);
    } catch (e) {
      setError(isAxiosError(e) && typeof e.response?.data?.message === 'string' ? e.response.data.message : e instanceof Error ? e.message : '削除できませんでした');
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!canSave) return;
    setBusy(true); setError(null);
    try {
      const savedCode = createdCode ?? code.trim();
      if (!createdCode && photo) {
        const status = await submit({ shelfCodeRaw: savedCode, displayLabel: memo.trim() || null, photo });
        clearShelfPhotoDraft();
        if (status === 'pending') onMessage?.('未送信に保存しました');
      } else {
        if ((memo.trim() || null) !== savedMemo) {
          await patchMobilePlacementShelfMemo(savedCode, memo.trim() || null);
          setSavedMemo(memo.trim() || null);
        }
        if (photo) await putMobilePlacementShelfPhoto(savedCode, photo);
      }
      if (shelf?.isStructured && piSelectionRequiresApply(zeroDraft, currentDeviceId)) {
        if (zeroDraft === ZERO2W_PI_CLEAR) {
          if (currentDeviceId) await assignPreset.mutateAsync({ clientDeviceId: currentDeviceId, shelfCodeRaw: null });
        } else {
          await assignPreset.mutateAsync({ clientDeviceId: zeroDraft, shelfCodeRaw: savedCode });
        }
      }
      onClose();
    } catch (e) {
      setError(isAxiosError(e) && typeof e.response?.data?.message === 'string' ? e.response.data.message : e instanceof Error ? e.message : '保存できませんでした');
    } finally {
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
      setBusy(false);
    }
  };
  const selectPhoto = async (file: File) => {
    setBusy(true); setError(null);
    try { setPhoto(await resizeShelfPhoto(file)); }
    catch (err) { setError(err instanceof Error ? err.message : '写真を処理できませんでした'); }
    finally { setBusy(false); }
  };
  const rotatePhoto = async () => {
    if (!photo && !shelf?.photoUpdatedAt) return;
    setBusy(true); setError(null);
    try {
      const source = photo ?? await resizeShelfPhoto(new File([await getMobilePlacementShelfPhoto(shelf!.shelfCodeRaw, shelf!.photoUpdatedAt!)], 'shelf.jpg', { type: 'image/jpeg' }));
      setPhoto(await rotateShelfPhoto(source));
    }
    catch (err) { setError(err instanceof Error ? err.message : '写真を回せませんでした'); }
    finally { setBusy(false); }
  };
  return { zeroSheet, setZeroSheet, selectedPi, setSelectedPi, zeroDraft, setZeroDraft, devices, currentDeviceId, draftDeviceId, draftDevice, input, cameraOpen, setCameraOpen, machine, setMachine, landmarkSheet, setLandmarkSheet, direction, setDirection, memo, setMemo, photo, setPhoto, createdCode, busy, setBusy, confirmDelete, setConfirmDelete, error, setError, directions, registeredDirections, code, canSave, deleteShelf, save, selectPhoto, rotatePhoto };
}
