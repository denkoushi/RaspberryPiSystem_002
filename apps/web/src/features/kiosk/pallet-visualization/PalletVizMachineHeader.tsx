import clsx from 'clsx';

import { PALLET_COUNT } from './palletVizNumberGridConfig';

const ILLU_W = 'w-60';
const ILLU_H = 'h-[10.5rem]';

export type PalletVizMachineHeaderProps = {
  illustrationUrl: string | null;
  machineName: string;
  machineCd: string;
  selectedPalletNo: number;
  onSelectPalletNo: (n: number) => void;
};

/**
 * 加工機イラスト、機名・資源CD・パレット選択中の表示、パレット番号グリッド（5×2）のレイアウト。
 * 表示専用：データ取得は親の責務。
 */
export function PalletVizMachineHeader({
  illustrationUrl,
  machineName,
  machineCd,
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

          <div
            className="grid w-full min-w-0 shrink-0 grid-cols-5 gap-2 sm:w-[17.5rem] sm:min-w-[17.5rem]"
            role="group"
            aria-label={`パレット番号1から${PALLET_COUNT}を選択`}
          >
            {Array.from({ length: PALLET_COUNT }, (_, i) => i + 1).map((n) => {
              const selected = selectedPalletNo === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`パレット${n}`}
                  onClick={() => onSelectPalletNo(n)}
                  className={clsx(
                    'rounded-lg py-2 text-center leading-none sm:py-3',
                    selected ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-white hover:bg-slate-700'
                  )}
                >
                  <span className="text-2xl font-bold tabular-nums sm:text-[1.75rem]">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
