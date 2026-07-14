import clsx from 'clsx';
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';
import { kioskButtonPrimaryClassName } from '../kiosk/kioskTheme';

import { splitIntoBalancedPanes, type SelfInspectionTableRow } from './selfInspectionTableModel';

export function resolveSelfInspectionPaneCount(width: number): number {
  if (width >= 1536) return 3;
  if (width >= 1280) return 2;
  return 1;
}

function useResponsivePaneCount(): number {
  const [paneCount, setPaneCount] = useState(() =>
    typeof window === 'undefined' ? 1 : resolveSelfInspectionPaneCount(window.innerWidth)
  );

  useEffect(() => {
    const update = () => setPaneCount(resolveSelfInspectionPaneCount(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return paneCount;
}

type Props = {
  rows: readonly SelfInspectionTableRow[];
  onCandidateSelect: (id: string) => void;
};

const toneClassNames: Record<SelfInspectionTableRow['statusTone'], string> = {
  danger: 'bg-red-400/20 text-red-100',
  info: 'bg-cyan-500/20 text-cyan-100',
  warning: 'bg-yellow-400/20 text-yellow-100'
};

function TablePane({ rows, onCandidateSelect }: Props) {
  return (
    <div className="min-w-0 overflow-hidden rounded border border-white/15 bg-slate-950/55">
      <table className="w-full table-fixed border-collapse text-left text-xs text-white">
        <colgroup>
          <col className="w-[29%]" />
          <col className="w-[14%]" />
          <col className="w-[19%]" />
          <col className="w-[38%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-slate-900 text-white/70 shadow-sm">
          <tr>
            <th className="px-2 py-2 font-semibold">製造order</th>
            <th className="px-1 py-2 font-semibold">資源CD</th>
            <th className="px-1 py-2 font-semibold">状態</th>
            <th className="px-2 py-2 text-center font-semibold">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={`${row.kind}:${row.id}`}>
              <tr className="border-t border-white/15 bg-slate-900/45 align-middle">
                <td className="truncate px-2 py-1.5 text-sm font-bold" title={row.productNo}>
                  {row.productNo || '—'}
                </td>
                <td className="truncate px-1 py-1.5" title={row.resourceCd}>
                  {row.resourceCd || '—'}
                </td>
                <td className="px-1 py-1.5">
                  <span className={clsx('inline-flex rounded px-1.5 py-1 font-semibold', toneClassNames[row.statusTone])}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  {row.action.kind === 'link' ? (
                    <Link
                      to={row.action.href}
                      className={buttonClassName(
                        'primary',
                        clsx(kioskButtonPrimaryClassName, 'inline-flex min-h-11 w-full items-center justify-center px-2 text-xs')
                      )}
                    >
                      {row.action.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={clsx(
                        row.statusLabel === '入力中' || row.statusLabel === '完了'
                          ? kioskButtonPrimaryClassName
                          : buttonClassName('ghostOnDark'),
                        'inline-flex min-h-11 w-full items-center justify-center px-2 text-xs'
                      )}
                      onClick={() => onCandidateSelect(row.id)}
                    >
                      {row.action.label}
                    </button>
                  )}
                </td>
              </tr>
              <tr className="border-b border-white/15 bg-slate-950/25">
                <td colSpan={4} className="px-2 pb-2 pt-1 text-[11px] leading-snug text-white/65">
                  <p className="line-clamp-1" title={row.detailLine}>{row.detailLine}</p>
                  <p className="line-clamp-1" title={row.progressLine}>{row.progressLine}</p>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SelfInspectionTable({ rows, onCandidateSelect }: Props) {
  const paneCount = useResponsivePaneCount();
  const panes = splitIntoBalancedPanes(rows, paneCount);

  return (
    <div
      data-testid="self-inspection-table-panes"
      data-pane-count={paneCount}
      className="grid items-start gap-2"
      style={{ gridTemplateColumns: `repeat(${paneCount}, minmax(0, 1fr))` }}
    >
      {panes.map((paneRows, index) => (
        <TablePane key={index} rows={paneRows} onCandidateSelect={onCandidateSelect} />
      ))}
    </div>
  );
}
