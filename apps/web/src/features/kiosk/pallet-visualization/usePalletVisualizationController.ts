import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

import type { PalletVizListItem } from './PalletVizItemList';

const BOARD_QUERY_KEY = 'kiosk-pallet-viz-board';

function mapItemsToListItems(items: PalletVisualizationItemDto[]): PalletVizListItem[] {
  return items.map((it) => ({
    id: it.id,
    fhincd: it.fhincd,
    fhinmei: it.fhinmei,
    fseiban: it.fseiban,
    machineName: it.machineName,
  }));
}

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

  const selectMachine = useCallback((cd: string) => {
    setSelectedCd(cd);
    setSelectedItemId(null);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PALLET_VIZ_SELECTED_MACHINE_LS_KEY, cd);
    }
  }, []);

  const currentMachine = useMemo(
    () => machines.find((m) => m.machineCd === selectedCd),
    [machines, selectedCd]
  );

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
    mutationFn: (barcode: string) =>
      postKioskPalletVisualizationItem(
        { machineCd: selectedCd, palletNo, manufacturingOrderBarcodeRaw: barcode },
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
    (raw: string) => {
      const barcode = raw.trim();
      if (!barcode) return;
      if (selectedItemId) {
        replaceMutation.mutate({ itemId: selectedItemId, barcode });
      } else {
        addMutation.mutate(barcode);
      }
    },
    [selectedItemId, addMutation, replaceMutation]
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
    (addMutation.error as Error | undefined)?.message ??
    (replaceMutation.error as Error | undefined)?.message ??
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
    handleScanSuccess,
    busy,
    deleteSelectedItem,
    clearCurrentPallet,
    mutationError,
  };
}
