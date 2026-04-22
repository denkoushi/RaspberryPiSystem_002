import clsx from 'clsx';

import { BarcodeScanModal } from '../../barcode-scan/BarcodeScanModal';
import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL } from '../../barcode-scan/formatPresets';

import { PalletVizActionRow } from './PalletVizActionRow';
import { PalletVizItemList } from './PalletVizItemList';
import { PalletVizPalletNumberGrid } from './PalletVizPalletNumberGrid';
import { usePalletVisualizationController } from './usePalletVisualizationController';

export type PalletVizEmbeddedPanelProps = {
  className?: string;
};

const ILLU_H_EMBED = 'h-28';
const ILLU_W_EMBED = 'w-full max-w-[17rem]';

/**
 * 持出画面左ペイン向け。表示順: 番号10 → 操作4 → イラスト → 機種名 → 部品カード。
 */
export function PalletVizEmbeddedPanel({ className }: PalletVizEmbeddedPanelProps) {
  const ctrl = usePalletVisualizationController();

  return (
    <>
      <BarcodeScanModal
        open={ctrl.scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={ctrl.handleScanSuccess}
        onAbort={() => ctrl.setScanOpen(false)}
      />

      <section
        className={clsx(
          'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-lg bg-slate-900/80 p-2 text-white ring-1 ring-white/10',
          className
        )}
      >
        <p className="shrink-0 text-xs font-semibold tracking-wide text-emerald-200/90">パレット</p>

        {ctrl.boardQuery.isError ? (
          <p className="shrink-0 text-xs text-red-300">読み込みに失敗しました</p>
        ) : ctrl.boardQuery.isFetching && !ctrl.boardQuery.data ? (
          <p className="shrink-0 text-xs text-white/60">読み込み中…</p>
        ) : null}

        <PalletVizPalletNumberGrid
          variant="compact"
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

        {ctrl.currentMachine ? (
          <>
            <div className="flex shrink-0 justify-center">
              {ctrl.currentMachine.illustrationUrl ? (
                <img
                  src={ctrl.currentMachine.illustrationUrl}
                  alt=""
                  className={clsx(
                    ILLU_H_EMBED,
                    ILLU_W_EMBED,
                    'rounded-md border border-white/10 object-contain'
                  )}
                />
              ) : (
                <div
                  className={clsx(
                    'flex items-center justify-center rounded-md border border-dashed border-white/20 text-xs text-white/50',
                    ILLU_H_EMBED,
                    ILLU_W_EMBED
                  )}
                >
                  イラスト未設定
                </div>
              )}
            </div>

            <div className="shrink-0 border-l-2 border-amber-400/80 pl-2">
              <h3 className="text-sm font-bold leading-snug text-white">{ctrl.currentMachine.machineName}</h3>
              <p className="font-mono text-xs text-white/60">{ctrl.currentMachine.machineCd}</p>
              <p className="mt-0.5 text-xs text-white/75">
                パレット <span className="font-mono font-bold text-amber-200">{ctrl.palletNo}</span> を選択中
              </p>
            </div>
          </>
        ) : (
          <p className="shrink-0 text-xs text-white/60">加工機データがありません</p>
        )}

        {ctrl.mutationError ? (
          <p className="shrink-0 text-xs text-red-300">{ctrl.mutationError}</p>
        ) : null}

        {ctrl.currentMachine ? (
          <PalletVizItemList
            items={ctrl.listItems}
            selectedItemId={ctrl.selectedItemId}
            onToggleItem={ctrl.toggleItemSelection}
          />
        ) : null}
      </section>
    </>
  );
}
