import clsx from 'clsx';

import { PalletVizPalletNumberGrid } from './PalletVizPalletNumberGrid';

const ILLU_W = 'w-60';
const ILLU_H = 'h-[10.5rem]';

export type PalletVizMachineHeaderProps = {
  illustrationUrl: string | null;
  machineName: string;
  machineCd: string;
  palletCount: number;
  selectedPalletNo: number;
  onSelectPalletNo: (n: number) => void;
};

/**
 * 加工機イラスト、機名・資源CD・パレット選択中の表示、パレット番号グリッド（5列）のレイアウト。
 * 表示専用：データ取得は親の責務。
 */
export function PalletVizMachineHeader({
  illustrationUrl,
  machineName,
  machineCd,
  palletCount,
  selectedPalletNo,
  onSelectPalletNo,
}: PalletVizMachineHeaderProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-start gap-3">
      {illustrationUrl ? (
        <img
          src={illustrationUrl}
          alt=""
          className={clsx(ILLU_H, ILLU_W, 'shrink-0 rounded-md border border-white/10 object-contain')}
        />
      ) : (
        <div
          className={clsx(
            'flex shrink-0 items-center justify-center rounded-md border border-dashed border-white/20 text-xs text-white/50',
            ILLU_H,
            ILLU_W
          )}
        >
          イラスト未設定
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:flex-nowrap sm:gap-3">
          <div className="w-full min-w-0 max-w-[22rem] sm:w-max">
            <h2 className="text-xl font-bold leading-snug text-white">{machineName}</h2>
            <p className="mt-1 font-mono text-sm text-white/70">{machineCd}</p>
            <p className="mt-2 text-sm text-white/80">
              パレット <span className="font-mono font-bold text-amber-200">{selectedPalletNo}</span> を選択中
            </p>
          </div>

          <PalletVizPalletNumberGrid
            palletCount={palletCount}
            selectedPalletNo={selectedPalletNo}
            onSelectPalletNo={onSelectPalletNo}
            variant="default"
          />
        </div>
      </div>
    </div>
  );
}
