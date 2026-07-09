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
import { kioskAssemblyWorkSessionPath } from './assemblyRoutes';
import { useAssemblyRowExpansion } from './assemblyRowExpansion';
import { AssemblyRowToggle } from './AssemblyRowToggle';
import { areaStatusShortText, progressPercent, progressText } from './assemblySessionPresentation';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyWorkSessionSummaryDto } from './types';

type Props = {
  sessions: AssemblyWorkSessionSummaryDto[];
  loading: boolean;
  onReload: () => void;
};

const WIP_COLUMNS = [
  { key: 'productNo', label: '製番', widthClassName: 'w-[34%]' },
  { key: 'progress', label: '進捗', widthClassName: 'w-[28%]' },
  { key: 'actions', label: '操作', widthClassName: 'w-[38%]', align: 'right' as const }
];

export function AssemblyWipPane({ sessions, loading, onReload }: Props) {
  const { isExpanded, toggle } = useAssemblyRowExpansion();

  return (
    <section
      aria-labelledby="assembly-wip-pane-heading"
      className="flex min-h-[10rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45 xl:min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-white/10 px-2 py-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <h2 id="assembly-wip-pane-heading" className="text-sm font-bold leading-tight text-white">
              仕掛中
            </h2>
            <span className="text-xs font-bold text-emerald-200">{sessions.length}件</span>
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
        ariaLabel="仕掛中"
        columns={WIP_COLUMNS}
        empty={sessions.length === 0}
        emptyMessage={loading ? '仕掛中を読込中…' : '仕掛中なし'}
      >
        {sessions.map((session) => {
          const href = kioskAssemblyWorkSessionPath(session.id);
          const areaText = areaStatusShortText(session);
          const expanded = isExpanded(session.id);
          const panelId = `assembly-wip-detail-${session.id}`;
          return (
            <Fragment key={session.id}>
              <tr className={assemblyTablePrimaryRowClassName}>
                <td className={assemblyTablePrimaryCellClassName} title={session.productNo}>
                  <AssemblyRowToggle
                    expanded={expanded}
                    onToggle={() => toggle(session.id)}
                    label={session.productNo}
                    controlsId={panelId}
                    className="inline-flex min-w-0 max-w-full items-center gap-1 rounded text-left font-bold text-white hover:text-emerald-100"
                  />
                </td>
                <td className="px-1.5 py-0.5">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-bold tabular-nums text-emerald-200">{progressText(session)}</span>
                    <span className="h-1 w-8 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full bg-cyan-300"
                        style={{ width: `${progressPercent(session)}%` }}
                      />
                    </span>
                  </span>
                </td>
                <td className="px-1.5 py-0.5">
                  <div className="flex justify-end gap-1">
                    <Link to={href} className={buttonClassName('primary', assemblyTableActionButtonClassName)}>
                      再開
                    </Link>
                  </div>
                </td>
              </tr>
              {expanded ? (
                <tr id={panelId} className={assemblyTableSecondaryRowClassName}>
                  <td colSpan={3} className={assemblyTableSecondaryCellClassName}>
                    {session.targetUnit} ・ {areaText} ・ {session.serialNo} / {session.operatorNameSnapshot} ・ 更新{' '}
                    {formatAssemblyTimestamp(session.updatedAt)}
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
