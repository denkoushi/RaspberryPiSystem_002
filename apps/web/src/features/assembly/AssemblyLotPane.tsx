import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../components/ui/Button';

import {
  AssemblyPaneTableShell,
  assemblyTableActionButtonClassName,
  assemblyTableGroupRowClassName,
  assemblyTableMutedCellClassName,
  assemblyTablePrimaryCellClassName,
  assemblyTablePrimaryRowClassName
} from './AssemblyPaneTableShell';
import { kioskAssemblyRecordApprovalPath, kioskAssemblyWorkSessionPath } from './assemblyRoutes';
import { useAssemblyRowExpansion } from './assemblyRowExpansion';
import { AssemblyRowToggle } from './AssemblyRowToggle';
import { lotProgressText, serialStatusClassName, serialStatusLabel } from './assemblyStatusPresentation';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyLotSerialDto, AssemblyLotSummaryDto } from './types';

type Props = {
  lots: AssemblyLotSummaryDto[];
  loading: boolean;
  busySerialId: string | null;
  onReload: () => void;
  onStartSerial: (lotId: string, lotSerialId: string) => void;
};

const LOT_COLUMNS = [
  { key: 'serialNo', label: 'シリアル', widthClassName: 'w-[42%]' },
  { key: 'status', label: '状態', widthClassName: 'w-[28%]' },
  { key: 'actions', label: '操作', widthClassName: 'w-[30%]', align: 'right' as const }
];

function SerialAction({
  lotId,
  serial,
  busySerialId,
  onStartSerial
}: {
  lotId: string;
  serial: AssemblyLotSerialDto;
  busySerialId: string | null;
  onStartSerial: (lotId: string, lotSerialId: string) => void;
}) {
  if (serial.status === 'not_started') {
    return (
      <Button
        type="button"
        variant="primary"
        className={assemblyTableActionButtonClassName}
        disabled={busySerialId === serial.id}
        onClick={() => onStartSerial(lotId, serial.id)}
      >
        {busySerialId === serial.id ? '開始中…' : '開始'}
      </Button>
    );
  }

  if (serial.workSessionId && serial.status === 'in_progress') {
    return (
      <Link
        to={kioskAssemblyWorkSessionPath(serial.workSessionId)}
        className={buttonClassName(
          'ghostOnDark',
          `${assemblyTableActionButtonClassName} border-emerald-200/40 bg-emerald-900/25 text-emerald-50 hover:bg-emerald-800/45`
        )}
      >
        再開
      </Link>
    );
  }

  if (serial.workSessionId && serial.status === 'completed') {
    return (
      <Link
        to={kioskAssemblyRecordApprovalPath({ sessionId: serial.workSessionId })}
        className={buttonClassName(
          'ghostOnDark',
          `${assemblyTableActionButtonClassName} border-cyan-200/40 bg-cyan-900/25 text-cyan-50 hover:bg-cyan-800/45`
        )}
      >
        記録確認
      </Link>
    );
  }

  return (
    <span className="inline-flex min-h-11 items-center justify-center rounded border border-white/10 px-2 text-xs font-bold text-white/55">
      開始不可
    </span>
  );
}

export function AssemblyLotPane({ lots, loading, busySerialId, onReload, onStartSerial }: Props) {
  const { isExpanded, toggle } = useAssemblyRowExpansion();

  return (
    <section
      aria-labelledby="assembly-lot-pane-heading"
      className="flex min-h-[10rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45 xl:min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-white/10 px-2 py-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <h2 id="assembly-lot-pane-heading" className="text-sm font-bold leading-tight text-white">
              登録済みロット
            </h2>
            <span className="text-xs font-bold text-cyan-200">{lots.length}件</span>
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
        ariaLabel="登録済みロット"
        columns={LOT_COLUMNS}
        empty={lots.length === 0}
        emptyMessage={loading ? 'ロットを読込中…' : '登録済みロットなし'}
      >
        {lots.map((lot) => {
          const expanded = isExpanded(lot.id);
          const panelId = `assembly-lot-serials-${lot.id}`;
          const groupLabel = `${lot.productNo} ・ ${lot.targetUnit} ・ ${lot.operatorNameSnapshot} ・ ${lotProgressText(lot)} ・ ${formatAssemblyTimestamp(lot.updatedAt)}`;
          return (
            <Fragment key={lot.id}>
              <tr className={assemblyTableGroupRowClassName}>
                <td colSpan={3} className="px-1.5 py-1 text-[11px] font-bold text-cyan-100">
                  <AssemblyRowToggle
                    expanded={expanded}
                    onToggle={() => toggle(lot.id)}
                    label={groupLabel}
                    controlsId={panelId}
                  />
                </td>
              </tr>
              {expanded
                ? lot.serials.map((serial, index) => {
                    const label = serialStatusLabel(serial);
                    const statusClassName = serialStatusClassName(serial);
                    return (
                      <tr
                        key={serial.id}
                        id={index === 0 ? panelId : undefined}
                        className={assemblyTablePrimaryRowClassName}
                      >
                        <td className={`${assemblyTablePrimaryCellClassName} tabular-nums`} title={serial.serialNo}>
                          {serial.serialNo}
                        </td>
                        <td className="px-1.5 py-0.5">
                          <span
                            className={`inline-flex min-h-6 items-center rounded border px-1.5 text-[10px] font-bold ${statusClassName}`}
                          >
                            {label}
                          </span>
                        </td>
                        <td className={`${assemblyTableMutedCellClassName} text-right`}>
                          <div className="flex justify-end gap-1">
                            <SerialAction
                              lotId={lot.id}
                              serial={serial}
                              busySerialId={busySerialId}
                              onStartSerial={onStartSerial}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : null}
            </Fragment>
          );
        })}
      </AssemblyPaneTableShell>
    </section>
  );
}
