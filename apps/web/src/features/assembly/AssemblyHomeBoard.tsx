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

// 機種名 | 製番 | 着手前 | 仕掛中 | 完了 | 完了数と操作
const GRID =
  'grid grid-cols-[minmax(12rem,20.5rem)_6.75rem_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.9fr)_5.75rem]';
const CHIP =
  'inline-flex h-8 min-w-[3rem] items-center justify-center gap-1.5 rounded border px-2 font-mono text-sm font-semibold tabular-nums disabled:opacity-60';
const CHIP_TONE: Record<AssemblyHomeUnitState, string> = {
  before: 'border-transparent bg-[#1f2730] text-[#8fb8ff] hover:bg-[#2a343f]',
  wip: 'border-[#f6b93b]/35 bg-[#1f2730] text-[#f6b93b] hover:bg-[#2a343f]',
  pending: 'border-[#ff7d61]/40 bg-[#ff7d61]/10 text-[#ff7d61] hover:bg-[#ff7d61]/20',
  done: 'border-transparent bg-[#35d6ae]/10 text-[#35d6ae] hover:bg-[#35d6ae]/20'
};
const ACTION =
  'inline-flex min-h-9 items-center rounded border border-[#2c3742] bg-[#1f2730] px-3 text-sm font-bold text-[#eef3f6] hover:bg-[#2a343f]';

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
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
    const className = clsx(CHIP, CHIP_TONE[unit.state], selected && 'ring-1 ring-[#eef3f6]');
    const picking = pickingRowId === row.id;
    const content =
      unit.state === 'wip' ? (
        <>
          <span>{unit.label}</span>
          <span className="font-sans text-[0.8125rem] font-bold text-[#eef3f6]">{unit.operatorName}</span>
          <span className="text-[0.8125rem] font-medium text-[#97a5b2]">{unit.progressText}</span>
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
          className={clsx(className, picking && 'outline-dashed outline-1 outline-offset-1 outline-[#97a5b2]')}
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
          <span aria-hidden="true" className="absolute bottom-0 left-0 h-0.5 bg-[#f6b93b]" style={{ width: `${unit.progressPercent}%` }} />
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
      <div className="flex flex-wrap content-center gap-1 border-l border-[#27313b] px-2.5 py-[3px]">
        {units.map((unit) => renderUnit(row, unit))}
      </div>
    );
  };

  return (
    <section aria-label="組立状況" className="flex min-h-0 min-w-0 flex-1 flex-col text-[0.9375rem] leading-tight text-[#eef3f6]">
      <div className={clsx(GRID, 'shrink-0 items-end border-b border-[#27313b] bg-[#161c22] text-[0.8125rem] font-black tracking-widest text-[#66768a]')}>
        <div className="px-3 py-2">機種名</div>
        <div className="px-2.5 py-2">製番</div>
        {(
          [
            ['着手前', counts.before, 'text-[#8fb8ff]'],
            ['仕掛中', counts.wip, 'text-[#f6b93b]'],
            ['完了', counts.pending + counts.done, 'text-[#35d6ae]']
          ] as const
        ).map(([label, count, tone]) => (
          <div key={label} className={clsx('flex items-baseline gap-2 border-l border-[#27313b] px-2.5 py-1.5', tone)}>
            <span className="font-mono text-xl font-semibold leading-none tracking-normal tabular-nums">{count}</span>
            <h2 className="text-[0.8125rem] font-black">{label}</h2>
            {label === '完了' && counts.pending > 0 ? (
              <span className="ml-auto text-xs font-bold tracking-normal text-[#ff7d61]">承認待ち {counts.pending}</span>
            ) : null}
          </div>
        ))}
        <div className="flex justify-end px-1.5 py-0.5">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded text-[#9fadb9] hover:bg-[#1f2730] hover:text-[#eef3f6] disabled:opacity-50"
            aria-label="再読込"
            disabled={loading}
            onClick={onReload}
          >
            <ReloadIcon />
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="p-4 text-sm font-semibold text-[#66768a]">{loading ? '読込中…' : 'ロットなし'}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="ロット一覧">
          {rows.map((row) => {
            const picking = pickingRowId === row.id;
            const selected = row.units.find((unit) => unit.key === selectedKey) ?? null;
            return (
              <li key={row.id} className="border-b border-[#27313b] even:bg-white/[0.02] hover:bg-white/[0.05]">
                <div className={clsx(GRID, 'min-h-[2.375rem]')}>
                  <span className="min-w-0 self-center break-words px-3 py-1 font-bold" title={row.machineName}>
                    {row.machineName}
                  </span>
                  <span className="self-center truncate px-2.5 font-mono text-[0.8125rem] tabular-nums text-[#9fadb9]" title={row.productNo}>
                    {row.productNo}
                  </span>
                  {lane(row, ['before'])}
                  {lane(row, ['wip'])}
                  {lane(row, ['pending', 'done'])}
                  <span className="flex items-center justify-end gap-0.5 pr-1.5 font-mono text-[0.8125rem] tabular-nums text-[#9fadb9]">
                    {row.finishedCount}/{row.totalCount}
                    <button
                      type="button"
                      className={clsx(
                        'inline-flex h-8 w-8 items-center justify-center rounded hover:bg-[#2a343f] hover:text-[#eef3f6]',
                        picking ? 'bg-[#2a343f] text-[#eef3f6]' : 'text-[#66768a]'
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
                </div>
                {selected ? (
                  <div
                    role="region"
                    aria-label={`${row.productNo}・${selected.workId} の操作`}
                    className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[#27313b] bg-[#161c22] px-3 py-2"
                  >
                    <span className="font-mono text-sm font-semibold">{selected.workId}</span>
                    <dl className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0.5 text-[0.8125rem]">
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
