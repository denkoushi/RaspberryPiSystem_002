import { getResolvedClientKey } from '../../api/client';
import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL } from '../../features/barcode-scan/formatPresets';
import {
  PalletVizActionRow,
  PalletVizItemList,
  PalletVizMachineHeader,
  usePalletVisualizationController,
} from '../../features/kiosk/pallet-visualization';

export function KioskPalletVisualizationPage() {
  const clientKey = getResolvedClientKey();
  const ctrl = usePalletVisualizationController({ clientKey });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 text-white">
      <BarcodeScanModal
        open={ctrl.scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={ctrl.handleScanSuccess}
        onAbort={() => ctrl.setScanOpen(false)}
      />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-emerald-200">パレット可視化</h1>
        {ctrl.boardQuery.isError ? (
          <span className="text-sm text-red-300">読み込みに失敗しました</span>
        ) : ctrl.boardQuery.isFetching ? (
          <span className="text-sm text-white/60">更新中…</span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
        <aside className="flex max-h-48 min-h-0 w-full shrink-0 flex-col gap-2 overflow-y-auto overscroll-y-contain rounded-lg bg-slate-900/80 p-2 lg:max-h-none lg:w-56">
          <p className="shrink-0 text-xs font-semibold text-white/60">加工機（資源CD順）</p>
          {ctrl.machines.map((m) => (
            <button
              key={m.machineCd}
              type="button"
              onClick={() => ctrl.selectMachine(m.machineCd)}
              className={`shrink-0 rounded-md px-2 py-2 text-left text-sm font-semibold transition-colors ${
                m.machineCd === ctrl.selectedMachineCd
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-white/90 hover:bg-slate-700'
              }`}
            >
              <div className="truncate">{m.machineName}</div>
              <div className="font-mono text-xs text-white/70">{m.machineCd}</div>
            </button>
          ))}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-lg bg-slate-900/60 p-3">
          {ctrl.currentMachine ? (
            <>
              <PalletVizMachineHeader
                illustrationUrl={ctrl.currentMachine.illustrationUrl ?? null}
                machineName={ctrl.currentMachine.machineName}
                machineCd={ctrl.currentMachine.machineCd}
                selectedPalletNo={ctrl.palletNo}
                onSelectPalletNo={ctrl.setPalletNo}
              />

              <PalletVizActionRow
                busy={ctrl.busy}
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

              {ctrl.mutationError ? (
                <p className="shrink-0 text-sm text-red-300">{ctrl.mutationError}</p>
              ) : null}
            </>
          ) : (
            <p className="text-white/60">加工機データを読み込めませんでした</p>
          )}
        </main>
      </div>
    </div>
  );
}
