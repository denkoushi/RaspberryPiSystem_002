import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getResolvedClientKey } from '../../api/client';
import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL } from '../../features/barcode-scan/formatPresets';
import {
  PalletVizActionRow,
  PalletVizItemList,
  PalletVizMobileTenkeyPad,
  resolvePalletNoFromTenkeyDigits,
  usePalletVisualizationController,
} from '../../features/kiosk/pallet-visualization';
import { mpKioskTheme } from '../../features/mobile-placement/ui/mobilePlacementKioskTheme';

function pushTenkeyDigit(prev: number[], d: number): number[] {
  if (prev.length >= 2) {
    return [d];
  }
  return [...prev, d];
}

/**
 * 配膳スマホ向けパレット可視化: 加工機 select + テンキー + スキャンで登録。ウェッジ/シリアルは使わない。
 */
export function KioskMobilePalletVisualizationPage() {
  const clientKey = getResolvedClientKey();
  const navigate = useNavigate();
  const ctrl = usePalletVisualizationController({ clientKey, enableKeyboardWedge: false, enableSerialBarcodeStream: false });

  const [digitBuffer, setDigitBuffer] = useState<number[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [orderScanOpen, setOrderScanOpen] = useState(false);

  useEffect(() => {
    setDigitBuffer([]);
    setLocalError(null);
  }, [ctrl.selectedMachineCd]);

  const handleDigit = useCallback((d: number) => {
    setLocalError(null);
    setDigitBuffer((prev) => pushTenkeyDigit(prev, d));
  }, []);

  const handleOrderScanSuccess = useCallback(
    (text: string) => {
      setOrderScanOpen(false);
      setLocalError(null);
      if (!ctrl.currentMachine) {
        setLocalError('加工機を選択してください');
        return;
      }
      const resolved = resolvePalletNoFromTenkeyDigits(digitBuffer, ctrl.currentMachine.palletCount);
      if (!resolved.ok) {
        setLocalError(resolved.message);
        return;
      }
      ctrl.setPalletNo(resolved.value);
      ctrl.addBarcodeToPallet(text, resolved.value);
      setDigitBuffer([]);
    },
    [ctrl, digitBuffer]
  );

  const busy = ctrl.busy;
  const tenkeyHint = useMemo(
    () => (digitBuffer.length === 0 ? '1〜9を1回、または2回押してから「製造orderをスキャン」' : '製造orderのバーコードをスキャンで確定'),
    [digitBuffer.length]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 text-white">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <button type="button" className={mpKioskTheme.partSearchButton} onClick={() => navigate('/kiosk/mobile-placement')}>
          配膳に戻る
        </button>
        <h1 className="min-w-0 text-lg font-extrabold text-amber-200">パレット可視化</h1>
      </div>

      <div className="shrink-0 space-y-1 rounded-[10px] border-l-4 border-l-teal-400 bg-[#001a18] px-2.5 py-2">
        <label className="text-xs font-bold uppercase tracking-wide text-neutral-400" htmlFor="pallet-viz-mobile-machine">
          加工機
        </label>
        <select
          id="pallet-viz-mobile-machine"
          className="w-full min-w-0 rounded-md border-2 border-teal-500 bg-black px-2 py-2 text-base font-bold text-white"
          value={ctrl.selectedMachineCd}
          onChange={(e) => ctrl.selectMachine(e.target.value)}
        >
          {ctrl.machines.map((m) => (
            <option key={m.machineCd} value={m.machineCd}>
              {m.machineName} ({m.machineCd})
            </option>
          ))}
        </select>
        {ctrl.currentMachine ? (
          <p className="text-xs text-neutral-400">
            パレット1〜{ctrl.currentMachine.palletCount}（既定10・管理画面で変更）
          </p>
        ) : null}
      </div>

      <BarcodeScanModal
        open={orderScanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={handleOrderScanSuccess}
        onAbort={() => setOrderScanOpen(false)}
      />
      <BarcodeScanModal
        open={ctrl.scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={ctrl.handleScanSuccess}
        onAbort={() => ctrl.setScanOpen(false)}
      />

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain">
        <PalletVizMobileTenkeyPad
          digitBuffer={digitBuffer}
          onDigit={handleDigit}
          onBackspace={() => {
            setLocalError(null);
            setDigitBuffer((p) => p.slice(0, -1));
          }}
          onClear={() => {
            setLocalError(null);
            setDigitBuffer([]);
          }}
          disabled={busy}
        />
        <p className="text-xs text-neutral-400">{tenkeyHint}</p>

        <button
          type="button"
          className={mpKioskTheme.orderSubmitButton}
          disabled={busy}
          onClick={() => {
            setLocalError(null);
            setOrderScanOpen(true);
          }}
        >
          製造orderをスキャン（確定）
        </button>

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
            <PalletVizItemList
              items={ctrl.listItems}
              selectedItemId={ctrl.selectedItemId}
              onToggleItem={ctrl.toggleItemSelection}
            />
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
