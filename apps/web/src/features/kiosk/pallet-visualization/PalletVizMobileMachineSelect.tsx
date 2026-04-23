export type PalletVizMobileMachineOption = {
  machineCd: string;
  machineName: string;
};

export type PalletVizMobileMachineSelectProps = {
  id: string;
  machines: readonly PalletVizMobileMachineOption[];
  value: string;
  onChange: (machineCd: string) => void;
  palletCount: number | null;
};

/**
 * 配膳スマホパレット・加工機セレクトとパレット台数の補足
 */
export function PalletVizMobileMachineSelect({
  id,
  machines,
  value,
  onChange,
  palletCount,
}: PalletVizMobileMachineSelectProps) {
  return (
    <div className="shrink-0 space-y-1 rounded-[10px] border-l-4 border-l-teal-400 bg-[#001a18] px-2.5 py-2">
      <label className="text-xs font-bold uppercase tracking-wide text-neutral-400" htmlFor={id}>
        加工機
      </label>
      <select
        id={id}
        className="w-full min-w-0 rounded-md border-2 border-teal-500 bg-black px-2 py-2 text-base font-bold text-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {machines.map((m) => (
          <option key={m.machineCd} value={m.machineCd}>
            {m.machineName} ({m.machineCd})
          </option>
        ))}
      </select>
      {palletCount != null ? (
        <p className="text-xs text-neutral-400">
          パレット1〜{palletCount}（既定10・管理画面で変更）
        </p>
      ) : null}
    </div>
  );
}
