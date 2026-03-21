import { Fragment } from 'react';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../../../features/kiosk/manualOrder/manualOrderOverviewTypography';
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

  const { seiban, hincd, proc, mach, part, showRowA, showRowB, title } = p;

  const rowASegments: Array<{ text: string; className: string }> = [];
  if (seiban.length > 0) rowASegments.push({ text: seiban, className: 'font-semibold tabular-nums text-white' });
  if (hincd.length > 0) rowASegments.push({ text: hincd, className: 'font-mono text-slate-200' });
  if (proc.length > 0) rowASegments.push({ text: proc, className: 'text-white/55' });

  const rowBSegments: Array<{ text: string; className: string; title?: string }> = [];
  if (part.length > 0) rowBSegments.push({ text: part, className: 'min-w-0 truncate text-white/85' });
  if (mach.length > 0) rowBSegments.push({ text: mach, className: 'truncate text-slate-400', title: mach });

  return (
    <div
      className={`min-w-0 space-y-1 rounded bg-slate-800/90 px-3 py-2 leading-snug text-white/85 ${KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS}`}
      title={title}
    >
      {showRowA ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
          {rowASegments.map((seg, i) => (
            <Fragment key={`a-${i}`}>
              {i > 0 ? (
                <span className="shrink-0 text-white/35" aria-hidden>
                  ·
                </span>
              ) : null}
              <span className={seg.className}>{seg.text}</span>
            </Fragment>
          ))}
        </div>
      ) : null}
      {showRowB ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
          {rowBSegments.map((seg, i) => (
            <Fragment key={`b-${i}`}>
              {i > 0 ? (
                <span className="shrink-0 text-white/35" aria-hidden>
                  ·
                </span>
              ) : null}
              <span className={seg.className} title={seg.title}>
                {seg.text}
              </span>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
