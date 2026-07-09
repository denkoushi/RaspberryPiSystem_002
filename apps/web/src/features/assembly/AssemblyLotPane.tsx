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
  { key: 'productNo', label: '製番', widthClassName: 'w-[18%]' },
  { key: 'serialNo', label: 'シリアル', widthClassName: 'w-[22%]' },
  { key: 'status', label: '状態', widthClassName: 'w-[16%]' },
  { key: 'progress', label: '進捗', widthClassName: 'w-[14%]' },
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
  return (
    <section
      aria-labelledby="assembly-lot-pane-heading"
      className="flex min-h-[15rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45 xl:min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="assembly-lot-pane-heading" className="text-[1.22rem] font-bold leading-tight text-white">
              登録済みロット
            </h2>
            <span className="text-base font-bold text-cyan-200">{lots.length}件</span>
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
        ariaLabel="登録済みロット"
        columns={LOT_COLUMNS}
        empty={lots.length === 0}
        emptyMessage={loading ? 'ロットを読込中…' : '登録済みロットなし'}
      >
        {lots.map((lot) => (
          <Fragment key={lot.id}>
            <tr className={assemblyTableGroupRowClassName}>
              <td colSpan={5} className="px-2 py-1.5 text-xs font-bold text-cyan-100">
                <span className="truncate">
                  {lot.productNo} ・ {lot.targetUnit} ・ {lot.operatorNameSnapshot} ・ {lotProgressText(lot)} ・{' '}
                  {formatAssemblyTimestamp(lot.updatedAt)}
                </span>
              </td>
            </tr>
            {lot.serials.map((serial) => {
              const label = serialStatusLabel(serial);
              const statusClassName = serialStatusClassName(serial);
              return (
                <tr key={serial.id} className={assemblyTablePrimaryRowClassName}>
                  <td className={`${assemblyTableMutedCellClassName} text-white/45`}>↳</td>
                  <td className={`${assemblyTablePrimaryCellClassName} tabular-nums`} title={serial.serialNo}>
                    {serial.serialNo}
                  </td>
                  <td className="px-2 pb-0.5 pt-1.5">
                    <span
                      className={`inline-flex min-h-7 items-center rounded border px-2 text-[11px] font-bold ${statusClassName}`}
                    >
                      {label}
                    </span>
                  </td>
                  <td className={`${assemblyTableMutedCellClassName} text-white/45`}>—</td>
                  <td className="px-2 pb-0.5 pt-1.5">
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
            })}
          </Fragment>
        ))}
      </AssemblyPaneTableShell>
    </section>
  );
}
