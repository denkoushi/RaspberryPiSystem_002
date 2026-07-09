import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../components/ui/Button';

import {
  AssemblyPaneTableShell,
  assemblyTableActionButtonClassName,
  assemblyTablePrimaryCellClassName,
  assemblyTablePrimaryRowClassName,
  assemblyTableSecondaryCellClassName,
  assemblyTableSecondaryRowClassName
} from './AssemblyPaneTableShell';
import { kioskAssemblyRecordApprovalPath } from './assemblyRoutes';
import { formatLotQty } from './assemblySessionPresentation';
import { completedApprovalClassName, completedApprovalLabel } from './assemblyStatusPresentation';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyWorkSessionSummaryDto } from './types';

type Props = {
  sessions: AssemblyWorkSessionSummaryDto[];
  loading: boolean;
  onReload: () => void;
  lotQtyByProductNo: Record<string, number>;
};

const COMPLETED_COLUMNS = [
  { key: 'productNo', label: '製番', widthClassName: 'w-[15%]' },
  { key: 'targetUnit', label: '機種', widthClassName: 'w-[16%]' },
  { key: 'serialNo', label: 'シリアル', widthClassName: 'w-[14%]' },
  { key: 'lotQty', label: 'ロット', widthClassName: 'w-[12%]' },
  { key: 'status', label: '状態', widthClassName: 'w-[18%]' },
  { key: 'actions', label: '操作', widthClassName: 'w-[25%]', align: 'right' as const }
];

export function AssemblyCompletedPane({ sessions, loading, onReload, lotQtyByProductNo }: Props) {
  return (
    <section
      aria-labelledby="assembly-completed-pane-heading"
      className="flex min-h-[12rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="assembly-completed-pane-heading" className="text-[1.22rem] font-bold leading-tight text-white">
              完了した製品
            </h2>
            <span className="text-base font-bold text-cyan-200">{sessions.length}件</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-10 shrink-0 !px-3 !py-0 text-sm"
          disabled={loading}
          onClick={onReload}
        >
          {loading ? '更新中…' : '再読込'}
        </Button>
      </div>

      <AssemblyPaneTableShell
        ariaLabel="完了した製品"
        columns={COMPLETED_COLUMNS}
        empty={sessions.length === 0}
        emptyMessage={loading ? '完了した製品を読込中…' : '完了した製品なし'}
      >
        {sessions.map((session) => {
          const href = kioskAssemblyRecordApprovalPath({ sessionId: session.id });
          const approvalLabel = completedApprovalLabel(session.approval);
          const approvalClassName = completedApprovalClassName(session.approval);
          const lotQty = formatLotQty(session.productNo, lotQtyByProductNo);
          return (
            <Fragment key={session.id}>
              <tr className={assemblyTablePrimaryRowClassName}>
                <td className={assemblyTablePrimaryCellClassName} title={session.productNo}>
                  <Link to={href} className="block truncate text-white hover:text-cyan-100">
                    {session.productNo}
                  </Link>
                </td>
                <td className="truncate px-2 pb-0.5 pt-1.5 font-semibold text-white/90" title={session.targetUnit}>
                  {session.targetUnit}
                </td>
                <td className={`${assemblyTablePrimaryCellClassName} tabular-nums`} title={session.serialNo}>
                  {session.serialNo}
                </td>
                <td className="px-2 pb-0.5 pt-1.5 text-right font-bold tabular-nums text-cyan-200">{lotQty}</td>
                <td className="px-2 pb-0.5 pt-1.5">
                  <span
                    className={`inline-flex min-h-7 items-center rounded border px-2 text-[11px] font-bold ${approvalClassName}`}
                  >
                    {approvalLabel}
                  </span>
                </td>
                <td className="px-2 pb-0.5 pt-1.5">
                  <div className="flex justify-end gap-1">
                    <Link
                      to={href}
                      className={buttonClassName('ghostOnDark', assemblyTableActionButtonClassName)}
                    >
                      記録確認
                    </Link>
                  </div>
                </td>
              </tr>
              <tr className={assemblyTableSecondaryRowClassName}>
                <td colSpan={6} className={assemblyTableSecondaryCellClassName}>
                  作業者 {session.operatorNameSnapshot} ・ 完了{' '}
                  {formatAssemblyTimestamp(session.completedAt ?? session.updatedAt)}
                </td>
              </tr>
            </Fragment>
          );
        })}
      </AssemblyPaneTableShell>
    </section>
  );
}
