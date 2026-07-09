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
import { useAssemblyRowExpansion } from './assemblyRowExpansion';
import { AssemblyRowToggle } from './AssemblyRowToggle';
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
  { key: 'productNo', label: '製番', widthClassName: 'w-[32%]' },
  { key: 'lotQty', label: 'ロット', widthClassName: 'w-[18%]' },
  { key: 'status', label: '状態', widthClassName: 'w-[22%]' },
  { key: 'actions', label: '操作', widthClassName: 'w-[28%]', align: 'right' as const }
];

export function AssemblyCompletedPane({ sessions, loading, onReload, lotQtyByProductNo }: Props) {
  const { isExpanded, toggle } = useAssemblyRowExpansion();

  return (
    <section
      aria-labelledby="assembly-completed-pane-heading"
      className="flex min-h-[10rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45 xl:min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-white/10 px-2 py-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <h2 id="assembly-completed-pane-heading" className="text-sm font-bold leading-tight text-white">
              完了した製品
            </h2>
            <span className="text-xs font-bold text-cyan-200">{sessions.length}件</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-10 shrink-0 !px-2.5 !py-0 text-xs"
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
          const expanded = isExpanded(session.id);
          const panelId = `assembly-completed-detail-${session.id}`;
          return (
            <Fragment key={session.id}>
              <tr className={assemblyTablePrimaryRowClassName}>
                <td className={assemblyTablePrimaryCellClassName} title={session.productNo}>
                  <AssemblyRowToggle
                    expanded={expanded}
                    onToggle={() => toggle(session.id)}
                    label={session.productNo}
                    controlsId={panelId}
                    className="inline-flex min-w-0 max-w-full items-center gap-1 rounded text-left font-bold text-white hover:text-cyan-100"
                  />
                </td>
                <td className="px-1.5 py-0.5 text-right font-bold tabular-nums text-cyan-200">{lotQty}</td>
                <td className="px-1.5 py-0.5">
                  <span
                    className={`inline-flex min-h-6 items-center rounded border px-1.5 text-[10px] font-bold ${approvalClassName}`}
                  >
                    {approvalLabel}
                  </span>
                </td>
                <td className="px-1.5 py-0.5">
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
              {expanded ? (
                <tr id={panelId} className={assemblyTableSecondaryRowClassName}>
                  <td colSpan={4} className={assemblyTableSecondaryCellClassName}>
                    {session.serialNo} ・ {session.targetUnit} ・ 作業者 {session.operatorNameSnapshot} ・ 完了{' '}
                    {formatAssemblyTimestamp(session.completedAt ?? session.updatedAt)}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </AssemblyPaneTableShell>
    </section>
  );
}
