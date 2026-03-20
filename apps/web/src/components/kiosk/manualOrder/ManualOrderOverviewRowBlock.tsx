import { presentManualOrderRow } from '../../../features/kiosk/manualOrder/manualOrderRowPresentation';

type Props = {
  fseiban: string;
  fhincd: string;
  processLabel: string;
  machineName: string;
  partName: string;
};

export function ManualOrderOverviewRowBlock({
  fseiban,
  fhincd,
  processLabel,
  machineName,
  partName
}: Props) {
  const p = presentManualOrderRow({
    fseiban,
    fhincd,
    processLabel,
    machineName,
    partName
  });
  if (!p) return null;

  const { seiban, hincd, proc, mach, part, showLine1, showLine2, showLine3, title } = p;

  return (
    <div
      className="min-w-0 space-y-1 rounded bg-slate-800/90 px-3 py-2 leading-snug text-white/85"
      title={title}
    >
      {showLine1 ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-xl">
          {seiban.length > 0 ? <span className="font-semibold tabular-nums text-white">{seiban}</span> : null}
          {seiban.length > 0 && hincd.length > 0 ? (
            <span className="text-white/35" aria-hidden>
              ·
            </span>
          ) : null}
          {hincd.length > 0 ? <span className="font-mono text-lg text-slate-200">{hincd}</span> : null}
        </div>
      ) : null}
      {showLine2 ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-xl">
          {proc.length > 0 ? <span className="text-white/55">{proc}</span> : null}
          {proc.length > 0 && part.length > 0 ? (
            <span className="text-white/35" aria-hidden>
              ·
            </span>
          ) : null}
          {part.length > 0 ? <span className="text-white/85">{part}</span> : null}
        </div>
      ) : null}
      {showLine3 ? (
        <div className="truncate text-lg text-slate-400" title={mach}>
          {mach}
        </div>
      ) : null}
    </div>
  );
}
