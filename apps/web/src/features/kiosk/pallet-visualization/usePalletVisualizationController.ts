import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  clearKioskPalletVisualizationPallet,
  deleteKioskPalletVisualizationItem,
  getKioskPalletVisualizationBoard,
  getResolvedClientKey,
  postKioskPalletVisualizationItem,
  postKioskPalletVisualizationItemReplace,
  type PalletVisualizationItemDto,
} from '../../../api/client';
import { useKeyboardWedgeScan } from '../../barcode-scan/useKeyboardWedgeScan';
import { useSerialBarcodeStream } from '../../barcode-scan/useSerialBarcodeStream';

import { PALLET_VIZ_SELECTED_MACHINE_LS_KEY } from './palletVisualizationStorage';
import { mapPalletVisualizationDtoToListItem } from './palletVizListItemMapping';

import type { PalletVizListItem } from './palletVizListItem';

const BOARD_QUERY_KEY = 'kiosk-pallet-viz-board';

function mapItemsToListItems(items: PalletVisualizationItemDto[]): PalletVizListItem[] {
  return items.map(mapPalletVisualizationDtoToListItem);
}

type ApiErrorPayload = {
  message?: string;
  errorCode?: string;
};

function resolveMutationError(error: unknown): string | null {
  if (!error) return null;
  if (isAxiosError(error)) {
    const data = error.response?.data as ApiErrorPayload | undefined;
    if (typeof data?.message === 'string' && data.message.trim()) {
      return data.message;
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return null;
}

export const __testables = {
  resolveMutationError,
};

export type UsePalletVisualizationControllerOptions = {
  clientKey?: string;
  /** false のときキーボードウェッジを張らない（テスト等） */
  enableKeyboardWedge?: boolean;
  /** false のときシリアル( barcode-agent )WebSocket を張らない（テスト等） */
  enableSerialBarcodeStream?: boolean;
};

/**
 * キオスクパレット可視化の取得・選択状態・mutation・ウェッジ入力をまとめる。
 * UI（本画面 / 埋め込み）から API 詳細を隠し、単一責務で再利用する。
 */
export function usePalletVisualizationController(options?: UsePalletVisualizationControllerOptions) {
  const clientKey = options?.clientKey ?? getResolvedClientKey();
  const enableKeyboardWedge = options?.enableKeyboardWedge !== false;
  const enableSerialBarcodeStream = options?.enableSerialBarcodeStream !== false;
  const queryClient = useQueryClient();

  const boardQuery = useQuery({
    queryKey: [BOARD_QUERY_KEY, clientKey],
    queryFn: () => getKioskPalletVisualizationBoard(clientKey),
    refetchInterval: 15_000,
  });

  const machines = useMemo(() => boardQuery.data?.machines ?? [], [boardQuery.data?.machines]);

  const [selectedCd, setSelectedCd] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(PALLET_VIZ_SELECTED_MACHINE_LS_KEY) ?? '';
  });
  const [palletNo, setPalletNo] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (machines.length === 0) return;
    const exists = machines.some((m) => m.machineCd === selectedCd);
    if (!selectedCd || !exists) {
      const next = machines[0]?.machineCd ?? '';
      setSelectedCd(next);
      if (typeof window !== 'undefined' && next) {
        window.localStorage.setItem(PALLET_VIZ_SELECTED_MACHINE_LS_KEY, next);
      }
    }
  }, [machines, selectedCd]);

  const currentMachine = useMemo(
    () => machines.find((m) => m.machineCd === selectedCd),
    [machines, selectedCd]
  );

  useEffect(() => {
    if (!currentMachine) return;
    const maxP = currentMachine.palletCount;
    setPalletNo((n) => {
      if (n > maxP) return maxP;
      if (n < 1) return 1;
      return n;
    });
  }, [currentMachine]);

  const selectMachine = useCallback((cd: string) => {
    setSelectedCd(cd);
    setSelectedItemId(null);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PALLET_VIZ_SELECTED_MACHINE_LS_KEY, cd);
    }
  }, []);

  const currentPallet = useMemo(
    () => currentMachine?.pallets.find((p) => p.palletNo === palletNo),
    [currentMachine, palletNo]
  );

  const listItems = useMemo(
    () => mapItemsToListItems(currentPallet?.items ?? []),
    [currentPallet?.items]
  );

  const invalidateBoard = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [BOARD_QUERY_KEY, clientKey] });
  }, [queryClient, clientKey]);

  const addMutation = useMutation({
    mutationFn: (input: { barcode: string; palletNoOverride?: number }) =>
      postKioskPalletVisualizationItem(
        {
          machineCd: selectedCd,
          palletNo: input.palletNoOverride ?? palletNo,
          manufacturingOrderBarcodeRaw: input.barcode,
        },
        clientKey
      ),
    onSuccess: () => {
      void invalidateBoard();
    },
  });

  const replaceMutation = useMutation({
    mutationFn: ({ itemId, barcode }: { itemId: string; barcode: string }) =>
      postKioskPalletVisualizationItemReplace(itemId, { manufacturingOrderBarcodeRaw: barcode }, clientKey),
    onSuccess: () => {
      setSelectedItemId(null);
      void invalidateBoard();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => deleteKioskPalletVisualizationItem(itemId, clientKey),
    onSuccess: () => {
      setSelectedItemId(null);
      void invalidateBoard();
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => clearKioskPalletVisualizationPallet(selectedCd, palletNo, clientKey),
    onSuccess: () => {
      void invalidateBoard();
    },
  });

  const applyBarcode = useCallback(
    (raw: string, options?: { palletNo?: number }) => {
      const barcode = raw.trim();
      if (!barcode) return;
      if (selectedItemId) {
        replaceMutation.mutate({ itemId: selectedItemId, barcode });
      } else {
        addMutation.mutate({ barcode, palletNoOverride: options?.palletNo });
      }
    },
    [selectedItemId, addMutation, replaceMutation]
  );

  const addBarcodeToPallet = useCallback(
    (raw: string, palletNoOverride: number) => {
      const barcode = raw.trim();
      if (!barcode) return;
      addMutation.mutate({ barcode, palletNoOverride });
    },
    [addMutation]
  );

  const handleScanSuccess = useCallback(
    (text: string) => {
      setScanOpen(false);
      applyBarcode(text);
    },
    [applyBarcode]
  );

  const busy =
    addMutation.isPending ||
    replaceMutation.isPending ||
    deleteMutation.isPending ||
    clearMutation.isPending;

  const barcodeInputActive = !scanOpen && !busy && Boolean(selectedCd);

  useKeyboardWedgeScan({
    active: enableKeyboardWedge && barcodeInputActive,
    onScan: applyBarcode,
  });

  useSerialBarcodeStream(enableSerialBarcodeStream && barcodeInputActive, applyBarcode);

  const handlePalletNoChange = useCallback((n: number) => {
    setPalletNo(n);
    setSelectedItemId(null);
  }, []);

  const toggleItemSelection = useCallback((id: string) => {
    setSelectedItemId((prev) => (prev === id ? null : id));
  }, []);

  const deleteSelectedItem = useCallback(() => {
    if (selectedItemId) deleteMutation.mutate(selectedItemId);
  }, [selectedItemId, deleteMutation]);

  const clearCurrentPallet = useCallback(() => {
    clearMutation.mutate();
  }, [clearMutation]);

  const mutationError =
    resolveMutationError(addMutation.error) ??
    resolveMutationError(replaceMutation.error) ??
    null;

  return {
    clientKey,
    boardQuery,
    machines,
    selectedMachineCd: selectedCd,
    selectMachine,
    palletNo,
    setPalletNo: handlePalletNoChange,
    selectedItemId,
    setSelectedItemId,
    toggleItemSelection,
    currentMachine,
    listItems,
    scanOpen,
    setScanOpen,
    applyBarcode,
    addBarcodeToPallet,
    handleScanSuccess,
    busy,
    deleteSelectedItem,
    clearCurrentPallet,
    mutationError,
  };
}
