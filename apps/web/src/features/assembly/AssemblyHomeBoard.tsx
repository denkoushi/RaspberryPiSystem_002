import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { countAssemblyHomeBoard } from './assemblyHomeBoardPresentation';
import {
  kioskAssemblyRecordApprovalPath,
  kioskAssemblyTraceabilityPath,
  kioskAssemblyWorkSessionPath
} from './assemblyRoutes';

import type { AssemblyHomeLotRowView, AssemblyHomeUnitState, AssemblyHomeUnitView } from './assemblyHomeBoardPresentation';
import type { AssemblyWorkUnitInvalidationTarget } from './AssemblyWorkUnitInvalidationDialog';

type Props = {
  rows: AssemblyHomeLotRowView[];
  loading: boolean;
  busySerialId: string | null;
  onReload: () => void;
  onStartSerial: (lotId: string, lotSerialId: string) => void;
  onInvalidate: (target: AssemblyWorkUnitInvalidationTarget) => void;
};

const GRID = 'grid grid-cols-[19rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]';
const CHIP =
  'inline-flex h-12 items-center gap-2 rounded-lg border px-3 font-mono text-lg font-semibold tabular-nums disabled:opacity-60';
const CHIP_TONE: Record<AssemblyHomeUnitState, string> = {
  before: 'border-[#2c3742] bg-[#1f2730] text-[#8fb8ff] hover:bg-[#2a343f]',
  wip: 'border-[#f6b93b]/35 bg-[#1f2730] text-[#f6b93b] hover:bg-[#2a343f]',
  pending: 'border-[#ff7d61]/40 bg-[#ff7d61]/10 text-[#ff7d61] hover:bg-[#ff7d61]/20',
  done: 'border-transparent bg-[#35d6ae]/10 text-[#35d6ae] hover:bg-[#35d6ae]/20'
};
const SEGMENT_TONE: Record<AssemblyHomeUnitState, string> = {
  before: 'bg-[#2a343f]',
  wip: 'bg-[#f6b93b]',
  pending: 'bg-[#ff7d61]',
  done: 'bg-[#35d6ae]'
};
const ACTION =
  'inline-flex min-h-11 items-center rounded-lg border border-[#2c3742] bg-[#1f2730] px-4 text-sm font-bold text-[#eef3f6] hover:bg-[#2a343f]';

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M7 5l12 7-12 7z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 5v5h-5" />
      <path d="M20 10a8 8 0 1 0 1 6" />
    </svg>
  );
}

export function AssemblyHomeBoard({ rows, loading, busySerialId, onReload, onStartSerial, onInvalidate }: Props) {
  const counts = useMemo(() => countAssemblyHomeBoard(rows), [rows]);
  const [pickingRowId, setPickingRowId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const renderUnit = (row: AssemblyHomeLotRowView, unit: AssemblyHomeUnitView) => {
    const name = `${row.productNo}・${unit.workId}`;
    const selected = selectedKey === unit.key;
    const className = clsx(CHIP, CHIP_TONE[unit.state], selected && 'ring-2 ring-[#eef3f6]');
    const picking = pickingRowId === row.id;
    const content =
      unit.state === 'wip' ? (
        <>
          <span>{unit.label}</span>
          <span className="font-sans text-sm font-bold text-[#eef3f6]">{unit.operatorName}</span>
          <span className="text-sm font-medium text-[#97a5b2]">{unit.progressText}</span>
        </>
      ) : (
        <>
          <span>{unit.label}</span>
          {unit.state === 'before' ? <PlayIcon /> : null}
        </>
      );

    if (picking || unit.state === 'pending' || unit.state === 'done') {
      return (
        <button
          key={unit.key}
          type="button"
          className={clsx(className, picking && 'outline-dashed outline-2 outline-offset-2 outline-[#97a5b2]')}
          aria-pressed={selected}
          aria-label={`${name} の操作を${selected ? '閉じる' : '開く'}`}
          onClick={() => setSelectedKey(selected ? null : unit.key)}
        >
          {content}
        </button>
      );
    }
    if (unit.state === 'wip' && unit.sessionId) {
      return (
        <Link
          key={unit.key}
          to={kioskAssemblyWorkSessionPath(unit.sessionId)}
          className={clsx(className, 'relative overflow-hidden')}
          aria-label={`${name} を再開`}
        >
          {content}
          <span aria-hidden="true" className="absolute bottom-0 left-0 h-[3px] bg-[#f6b93b]" style={{ width: `${unit.progressPercent}%` }} />
        </Link>
      );
    }
    return (
      <button
        key={unit.key}
        type="button"
        className={className}
        aria-label={`${name} を開始`}
        disabled={!unit.lotId || !unit.lotSerialId || busySerialId === unit.lotSerialId}
        onClick={() => {
          if (unit.lotId && unit.lotSerialId) onStartSerial(unit.lotId, unit.lotSerialId);
        }}
      >
        {content}
      </button>
    );
  };

  const lane = (row: AssemblyHomeLotRowView, states: AssemblyHomeUnitState[]) => {
    const units = row.units.filter((unit) => states.includes(unit.state));
    return (
      <div className="flex flex-wrap content-center gap-2 border-l border-[#2c3742] px-4 py-3">
        {units.length === 0 ? <span className="text-sm text-[#617080]" aria-hidden="true">—</span> : units.map((unit) => renderUnit(row, unit))}
      </div>
    );
  };

  return (
    <section aria-label="組立状況" className="flex min-h-0 min-w-0 flex-1 flex-col text-[#eef3f6]">
      <div className={clsx(GRID, 'shrink-0 border-b border-[#2c3742]')}>
        <div className="flex items-end justify-between gap-2 px-4 py-3">
          <span className="text-sm font-bold text-[#617080]">製番 {rows.length}ロット</span>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[#97a5b2] hover:bg-[#1f2730] hover:text-[#eef3f6] disabled:opacity-50"
            aria-label="再読込"
            disabled={loading}
            onClick={onReload}
          >
            <ReloadIcon />
          </button>
        </div>
        {(
          [
            ['着手前', counts.before, 'text-[#8fb8ff]'],
            ['仕掛中', counts.wip, 'text-[#f6b93b]'],
            ['完了', counts.pending + counts.done, 'text-[#35d6ae]']
          ] as const
        ).map(([label, count, tone]) => (
          <div key={label} className={clsx('flex items-baseline gap-3 border-l border-[#2c3742] px-4 py-3', tone)}>
            <span className="font-mono text-4xl font-semibold leading-none tabular-nums">{count}</span>
            <h2 className="text-lg font-black tracking-widest">{label}</h2>
            {label === '完了' && counts.pending > 0 ? (
              <span className="ml-auto text-sm font-bold text-[#ff7d61]">承認待ち {counts.pending}</span>
            ) : null}
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-sm font-semibold text-[#617080]">{loading ? '読込中…' : 'ロットなし'}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="ロット一覧">
          {rows.map((row) => {
            const picking = pickingRowId === row.id;
            const selected = row.units.find((unit) => unit.key === selectedKey) ?? null;
            return (
              <li key={row.id} className="border-b border-[#2c3742]">
                <div className={clsx(GRID, 'min-h-[5.75rem]')}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] content-center gap-x-2 px-4 py-3">
                    <span className="truncate font-mono text-xl font-semibold" title={row.productNo}>{row.productNo}</span>
                    <span className="flex items-center gap-1 font-mono text-sm tabular-nums text-[#97a5b2]">
                      {row.finishedCount}/{row.totalCount}
                      <button
                        type="button"
                        className={clsx(
                          'inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-[#2a343f] hover:text-[#eef3f6]',
                          picking ? 'bg-[#2a343f] text-[#eef3f6]' : 'text-[#617080]'
                        )}
                        aria-pressed={picking}
                        aria-label={`${row.productNo} の台を選んで操作`}
                        onClick={() => {
                          setPickingRowId(picking ? null : row.id);
                          setSelectedKey(null);
                        }}
                      >
                        <DotsIcon />
                      </button>
                    </span>
                    <span className="col-span-2 truncate text-sm text-[#97a5b2]" title={row.machineName}>{row.machineName}</span>
                    <span className="col-span-2 mt-2 flex gap-[3px]" aria-hidden="true">
                      {row.units.map((unit) => (
                        <i key={unit.key} className={clsx('h-[5px] flex-1 rounded-sm', SEGMENT_TONE[unit.state])} />
                      ))}
                    </span>
                  </div>
                  {lane(row, ['before'])}
                  {lane(row, ['wip'])}
                  {lane(row, ['pending', 'done'])}
                </div>
                {selected ? (
                  <div
                    role="region"
                    aria-label={`${row.productNo}・${selected.workId} の操作`}
                    className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#2c3742] bg-[#161c22] px-4 py-3"
                  >
                    <span className="font-mono text-base font-semibold">{selected.workId}</span>
                    <dl className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1 text-sm">
                      {selected.details.map((detail) => (
                        <div key={detail.label} className="flex min-w-0 gap-2">
                          <dt className="shrink-0 text-[#617080]">{detail.label}</dt>
                          <dd className="min-w-0 break-words font-semibold">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      {selected.sessionId && (selected.state === 'pending' || selected.state === 'done') ? (
                        <>
                          <Link to={kioskAssemblyRecordApprovalPath({ sessionId: selected.sessionId })} className={ACTION}>
                            記録確認
                          </Link>
                          <Link to={kioskAssemblyTraceabilityPath({ workId: selected.workId })} className={ACTION}>
                            正式ID
                          </Link>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className={clsx(ACTION, '!text-[#ff7d61]')}
                        onClick={() =>
                          onInvalidate({
                            workUnitId: selected.workUnitId,
                            productNo: row.productNo,
                            workId: selected.workId,
                            stateLabel: selected.stateLabel
                          })
                        }
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
