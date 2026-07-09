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
import { areaStatusShortText, progressPercent, progressText } from './assemblySessionPresentation';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyWorkSessionSummaryDto } from './types';

type Props = {
  sessions: AssemblyWorkSessionSummaryDto[];
  loading: boolean;
  onReload: () => void;
};

const WIP_COLUMNS = [
  { key: 'productNo', label: '製番', widthClassName: 'w-[16%]' },
  { key: 'targetUnit', label: '機種', widthClassName: 'w-[18%]' },
  { key: 'area', label: 'エリア・位置', widthClassName: 'w-[28%]' },
  { key: 'progress', label: '進捗', widthClassName: 'w-[18%]' },
  { key: 'actions', label: '操作', widthClassName: 'w-[20%]', align: 'right' as const }
];

export function AssemblyWipPane({ sessions, loading, onReload }: Props) {
  return (
    <section
      aria-labelledby="assembly-wip-pane-heading"
      className="flex min-h-[12rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45 xl:min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="assembly-wip-pane-heading" className="text-[1.22rem] font-bold leading-tight text-white">
              仕掛中
            </h2>
            <span className="text-base font-bold text-emerald-200">{sessions.length}件</span>
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
        ariaLabel="仕掛中"
        columns={WIP_COLUMNS}
        empty={sessions.length === 0}
        emptyMessage={loading ? '仕掛中を読込中…' : '仕掛中なし'}
      >
        {sessions.map((session) => {
          const href = kioskAssemblyWorkSessionPath(session.id);
          const areaText = areaStatusShortText(session);
          return (
            <Fragment key={session.id}>
              <tr className={assemblyTablePrimaryRowClassName}>
                <td className={assemblyTablePrimaryCellClassName} title={session.productNo}>
                  <Link to={href} className="block truncate text-white hover:text-emerald-100">
                    {session.productNo}
                  </Link>
                </td>
                <td className="truncate px-2 pb-0.5 pt-1.5 font-semibold text-white/90" title={session.targetUnit}>
                  {session.targetUnit}
                </td>
                <td className="truncate px-2 pb-0.5 pt-1.5 font-semibold text-white/85" title={areaText}>
                  {areaText}
                </td>
                <td className="px-2 pb-0.5 pt-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-bold tabular-nums text-emerald-200">{progressText(session)}</span>
                    <span className="h-1.5 w-10 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full bg-cyan-300"
                        style={{ width: `${progressPercent(session)}%` }}
                      />
                    </span>
                  </span>
                </td>
                <td className="px-2 pb-0.5 pt-1.5">
                  <div className="flex justify-end gap-1">
                    <Link
                      to={href}
                      className={buttonClassName('primary', assemblyTableActionButtonClassName)}
                    >
                      再開
                    </Link>
                  </div>
                </td>
              </tr>
              <tr className={assemblyTableSecondaryRowClassName}>
                <td colSpan={5} className={assemblyTableSecondaryCellClassName}>
                  {session.serialNo} / {session.operatorNameSnapshot} ・ 更新{' '}
                  {formatAssemblyTimestamp(session.updatedAt)}
                </td>
              </tr>
            </Fragment>
          );
        })}
      </AssemblyPaneTableShell>
    </section>
  );
}
