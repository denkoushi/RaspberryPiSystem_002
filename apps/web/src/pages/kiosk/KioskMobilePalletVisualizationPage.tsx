import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getResolvedClientKey } from '../../api/client';
import {
  BarcodeScanModal,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE,
  BARCODE_READER_OPTIONS_KIOSK_DEFAULT,
} from '../../features/barcode-scan';
import {
  applyMobilePalletOrderScan,
  PalletVizActionRow,
  PalletVizItemList,
  PalletVizMobileMachineSelect,
  PalletVizMobilePageHeader,
  PalletVizMobileTenkeyPad,
  resolvePalletNoFromTenkeyDigitsImmediate,
  useKioskMobilePalletDigitBuffer,
  usePalletTenkeyNavBusy,
  usePalletVisualizationController,
} from '../../features/kiosk/pallet-visualization';

/**
 * 配膳スマホ向けパレット可視化: 加工機 select + テンキー + スキャンで登録。ウェッジ/シリアルは使わない。
 */
export function KioskMobilePalletVisualizationPage() {
  const clientKey = getResolvedClientKey();
  const navigate = useNavigate();
  const ctrl = usePalletVisualizationController({ clientKey, enableKeyboardWedge: false, enableSerialBarcodeStream: false });

  const { digits, appendDigit, backspace, clear, reset } = useKioskMobilePalletDigitBuffer({
    resetKey: ctrl.selectedMachineCd,
  });

  const [localError, setLocalError] = useState<string | null>(null);
  const [orderScanOpen, setOrderScanOpen] = useState(false);
  const { navBusy, pulseNavBusy } = usePalletTenkeyNavBusy();

  useEffect(() => {
    setLocalError(null);
  }, [ctrl.selectedMachineCd]);

  const maxPallet = ctrl.currentMachine?.palletCount;
  const { palletNo, setPalletNo } = ctrl;
  useEffect(() => {
    if (maxPallet == null || maxPallet < 1) return;
    const resolved = resolvePalletNoFromTenkeyDigitsImmediate(digits, maxPallet);
    if (resolved === null) return;
    if (resolved !== palletNo) {
      setPalletNo(resolved);
    }
  }, [digits, maxPallet, palletNo, setPalletNo]);

  const handleOrderScanSuccess = useCallback(
    (text: string) => {
      setOrderScanOpen(false);
      setLocalError(null);
      const result = applyMobilePalletOrderScan(text, digits, {
        palletCount: ctrl.currentMachine?.palletCount,
        setPalletNo: ctrl.setPalletNo,
        addBarcodeToPallet: ctrl.addBarcodeToPallet,
      });
      if (!result.ok) {
        setLocalError(result.message);
        return;
      }
      reset();
    },
    [ctrl.addBarcodeToPallet, ctrl.currentMachine?.palletCount, ctrl.setPalletNo, digits, reset]
  );

  const busy = ctrl.busy;
  const tenkeyDisabled = busy || navBusy;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 text-white">
      <PalletVizMobilePageHeader
        digits={digits}
        title="パレット可視化"
        onNavigateBack={() => navigate('/kiosk/mobile-placement')}
      />

      <PalletVizMobileMachineSelect
        id="pallet-viz-mobile-machine"
        machines={ctrl.machines}
        value={ctrl.selectedMachineCd}
        onChange={ctrl.selectMachine}
        palletCount={ctrl.currentMachine?.palletCount ?? null}
      />

      <BarcodeScanModal
        open={orderScanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE}
        readerOptions={BARCODE_READER_OPTIONS_KIOSK_DEFAULT}
        idleTimeoutMs={30_000}
        onSuccess={handleOrderScanSuccess}
        onAbort={() => setOrderScanOpen(false)}
      />
      <BarcodeScanModal
        open={ctrl.scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE}
        readerOptions={BARCODE_READER_OPTIONS_KIOSK_DEFAULT}
        idleTimeoutMs={30_000}
        onSuccess={ctrl.handleScanSuccess}
        onAbort={() => ctrl.setScanOpen(false)}
      />

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain">
        <PalletVizMobileTenkeyPad
          onDigit={(d) => {
            setLocalError(null);
            pulseNavBusy();
            appendDigit(d);
          }}
          onBackspace={() => {
            setLocalError(null);
            pulseNavBusy();
            backspace();
          }}
          onClear={() => {
            setLocalError(null);
            pulseNavBusy();
            clear();
          }}
          onOpenOrderScan={() => {
            setLocalError(null);
            setOrderScanOpen(true);
          }}
          disabled={tenkeyDisabled}
        />

        {ctrl.currentMachine ? (
          <>
            <PalletVizActionRow
              density="compact"
              busy={busy}
              canOperate={Boolean(ctrl.selectedMachineCd)}
              canClearPallet={Boolean(ctrl.currentMachine)}
              hasSelectedItem={Boolean(ctrl.selectedItemId)}
              onAdd={() => ctrl.setScanOpen(true)}
              onOverwrite={() => ctrl.setScanOpen(true)}
              onDelete={ctrl.deleteSelectedItem}
              onClearPallet={ctrl.clearCurrentPallet}
            />
            <div className="relative min-h-0">
              {navBusy ? (
                <div
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-black/25"
                  aria-hidden
                >
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-amber-300" />
                </div>
              ) : null}
              <PalletVizItemList
                items={ctrl.listItems}
                selectedItemId={ctrl.selectedItemId}
                onToggleItem={ctrl.toggleItemSelection}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-red-300">加工機を読み込めません</p>
        )}

        {localError ? <p className="text-sm text-red-300">{localError}</p> : null}
        {ctrl.mutationError ? <p className="text-sm text-red-300">{ctrl.mutationError}</p> : null}
        {ctrl.boardQuery.isError ? <p className="text-sm text-red-300">板データの取得に失敗しました</p> : null}
      </div>
    </div>
  );
}
