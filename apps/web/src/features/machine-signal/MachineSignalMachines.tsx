import clsx from 'clsx';
import { useEffect, useRef } from 'react';

import { useMachineSignalTrend } from '../../api/hooks';

import {
  buildSignalStopBucketLabels,
  formatSignalClock,
  formatSignalDuration,
  SIGNAL_CATEGORY_COLORS,
  SIGNAL_CATEGORY_LABELS
} from './machineSignalViewModel';
import { SignalAxis, SignalBand } from './SignalBand';
import { DurationQuantity, HintTag, Quantity, signalPanelClass } from './signalUi';

import type { MachineSignalDay, MachineSignalMachineDay, MachineSignalTrendPoint } from '../../api/client';

const ROW_GRID = 'grid grid-cols-[172px_minmax(0,1fr)_62px_58px_66px_96px] items-center gap-2.5 px-3';

function MachineList({
  machines,
  dayStartMinute,
  selected,
  onSelect
}: {
  machines: MachineSignalMachineDay[];
  dayStartMinute: number;
  selected: number | null;
  onSelect: (signalNo: number) => void;
}) {
  const selectedRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  return (
    <section className={clsx(signalPanelClass, 'flex min-h-0 flex-col')}>
      <div className={clsx(ROW_GRID, 'h-[34px] shrink-0 border-b border-[#243347] text-[13px] text-[#8b9cb2]')}>
        <span>機械</span>
        <SignalAxis dayStartMinute={dayStartMinute} className="h-4" />
        <span className="text-right">稼働</span>
        <span className="text-right">停止</span>
        <span className="text-right">連続平均</span>
        <span>気づき</span>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {machines.map((machine) => {
          const isSelected = machine.signalNo === selected;
          return (
            <button
              key={machine.signalNo}
              ref={isSelected ? selectedRow : undefined}
              type="button"
              aria-current={isSelected}
              onClick={() => onSelect(machine.signalNo)}
              className={clsx(
                ROW_GRID,
                'h-[30px] w-full border-b border-[#1b2736] text-left text-[15px] hover:bg-[#18232f]',
                isSelected && 'bg-[#1d2b3d]'
              )}
            >
              <span className="truncate font-semibold">
                <span className="mr-1.5 font-mono text-xs font-normal text-[#5d6e84]">{machine.signalNo}</span>
                {machine.name}
              </span>
              <SignalBand timeline={machine.timeline} className="h-4" label={`${machine.name} の24時間`} />
              <span className="text-right font-mono">
                <DurationQuantity seconds={machine.runSeconds} />
              </span>
              <span className="text-right font-mono">
                <Quantity value={machine.stopCount} unit="回" />
              </span>
              <span className="text-right font-mono">
                {machine.runBlockCount > 0 ? <DurationQuantity seconds={machine.averageRunSeconds} /> : '–'}
              </span>
              <span>
                <HintTag hint={machine.hint} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#243347] px-2.5 py-2">
      <span className="block text-xs text-[#8b9cb2]">{label}</span>
      <b className="font-mono text-2xl font-semibold">{children}</b>
    </div>
  );
}

const TREND_HEIGHT = 34;

/** 日ごとの値を細い棒で並べる。最後の日（表示中の日）だけ強く出す。 */
function TrendBars({
  label,
  points,
  valueOf,
  format,
  color
}: {
  label: string;
  points: MachineSignalTrendPoint[];
  valueOf: (point: MachineSignalTrendPoint) => number;
  format: (value: number) => string;
  color: string;
}) {
  const max = Math.max(1, ...points.map(valueOf));
  const last = points[points.length - 1];
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)_72px] items-center gap-2 text-sm">
      <span>{label}</span>
      <svg viewBox={`0 0 ${points.length * 6} ${TREND_HEIGHT}`} preserveAspectRatio="none" className="block h-[34px] w-full" role="img" aria-label={`${label}の推移`}>
        {points.map((point, index) => {
          const height = Math.max(1, (valueOf(point) / max) * TREND_HEIGHT);
          return (
            <rect
              key={point.reportDate}
              x={index * 6}
              y={TREND_HEIGHT - height}
              width={4.5}
              height={height}
              fill={color}
              opacity={index === points.length - 1 ? 1 : 0.5}
            />
          );
        })}
      </svg>
      <span className="text-right font-mono">{last ? format(valueOf(last)) : '–'}</span>
    </div>
  );
}

function MachineDetail({ machine, day }: { machine: MachineSignalMachineDay; day: MachineSignalDay }) {
  const trend = useMachineSignalTrend({ signalNo: machine.signalNo, endDate: day.reportDate, days: 30 });
  const points = trend.data ?? [];
  const bucketLabels = buildSignalStopBucketLabels(day.thresholds);
  const maxBucket = Math.max(1, ...machine.stopBuckets.map((bucket) => bucket.seconds));

  return (
    <section className={clsx(signalPanelClass, 'flex min-h-0 flex-col gap-3.5 overflow-y-auto px-4 py-3.5')}>
      <div>
        <h2 className="flex flex-wrap items-center gap-2.5 text-xl font-bold">
          {machine.name}
          <HintTag hint={machine.hint} />
        </h2>
        <p className="mt-0.5 text-xs text-[#8b9cb2]">
          {[machine.site, machine.name !== machine.sourceMachineName ? machine.sourceMachineName : null, `Signal ${machine.signalNo}`]
            .filter(Boolean)
            .join(' ・ ')}
          {machine.estimatedKwh !== null ? ` ・ 推定 ${Math.round(machine.estimatedKwh).toLocaleString()} kWh` : ''}
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2">
        <Kpi label="稼働">
          <DurationQuantity seconds={machine.runSeconds} />
        </Kpi>
        <Kpi label="停止">
          <Quantity value={machine.stopCount} unit="回" />
        </Kpi>
        <Kpi label="連続平均">{machine.runBlockCount > 0 ? <DurationQuantity seconds={machine.averageRunSeconds} /> : '–'}</Kpi>
        <Kpi label="連続最長">{machine.runBlockCount > 0 ? <DurationQuantity seconds={machine.longestRunSeconds} /> : '–'}</Kpi>
        <Kpi label="赤ランプ">
          <Quantity value={machine.alarmCount} unit="回" />
        </Kpi>
      </div>

      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold text-[#8b9cb2]">24時間</h3>
        <SignalBand timeline={machine.timeline} className="h-11" label={`${machine.name} の24時間`} />
        <SignalAxis dayStartMinute={day.dayStartMinute} className="mt-0.5 h-5" />
        <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-[#8b9cb2]">
          {SIGNAL_CATEGORY_LABELS.map((label, index) => (
            <span key={label}>
              <i
                className={clsx('mr-[5px] inline-block h-2.5 w-2.5 rounded-sm align-[-1px]', index === 5 && 'outline outline-1 outline-[#243347]')}
                style={{ backgroundColor: SIGNAL_CATEGORY_COLORS[index] }}
              />
              {label}
              {machine.categorySeconds[index] > 0 ? ` ${formatSignalDuration(machine.categorySeconds[index])}` : ''}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold text-[#8b9cb2]">停止の長さ</h3>
        {machine.stopCount === 0 ? (
          <p className="text-sm text-[#8b9cb2]">停止なし</p>
        ) : (
          machine.stopBuckets.map((bucket, index) => (
            <div key={index} className="grid h-[26px] grid-cols-[112px_minmax(0,1fr)_54px_70px] items-center gap-2 text-sm">
              <span>{bucketLabels[index]}</span>
              <span className="h-3 overflow-hidden rounded-[3px] bg-[#1a2533]">
                <span className="block h-full bg-[#e2cc52]" style={{ width: `${(bucket.seconds / maxBucket) * 100}%` }} />
              </span>
              <span className="text-right font-mono">
                <Quantity value={bucket.count} unit="回" />
              </span>
              <span className="text-right font-mono">{bucket.seconds > 0 ? <DurationQuantity seconds={bucket.seconds} /> : '–'}</span>
            </div>
          ))
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold text-[#8b9cb2]">長い停止</h3>
        {machine.longestStops.length === 0 ? (
          <p className="text-sm text-[#8b9cb2]">なし</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {machine.longestStops.map((stop) => (
                <tr key={stop.startSecond} className="border-b border-[#1b2736]">
                  <td className="py-[5px] pr-2 font-mono">{formatSignalClock(stop.startSecond, day.dayStartMinute)}</td>
                  <td className="py-[5px] pr-2 font-mono">{formatSignalDuration(stop.durationSeconds)}</td>
                  <td className="py-[5px]">{stop.stateName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {points.length > 1 ? (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold text-[#8b9cb2]">30日の推移</h3>
          <div className="grid gap-1">
            <TrendBars label="稼働" points={points} valueOf={(point) => point.runSeconds} format={formatSignalDuration} color="#35b37e" />
            <TrendBars label="連続平均" points={points} valueOf={(point) => point.averageRunSeconds} format={formatSignalDuration} color="#6fb0ff" />
            <TrendBars label="短い停止" points={points} valueOf={(point) => point.shortStopCount} format={(value) => `${value}回`} color="#f3e7a0" />
            <TrendBars label="赤ランプ" points={points} valueOf={(point) => point.alarmCount} format={(value) => `${value}回`} color="#ef5350" />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** 機械別ページ。左に全機械の24時間帯、右に選んだ1台の詳細。 */
export function MachineSignalMachines({
  day,
  machines,
  selected,
  onSelect
}: {
  day: MachineSignalDay;
  machines: MachineSignalMachineDay[];
  selected: number | null;
  onSelect: (signalNo: number) => void;
}) {
  const machine = machines.find((candidate) => candidate.signalNo === selected) ?? machines[0];
  return (
    <div className="grid min-h-0 flex-1 gap-2.5 min-[1100px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <MachineList machines={machines} dayStartMinute={day.dayStartMinute} selected={machine?.signalNo ?? null} onSelect={onSelect} />
      {machine ? <MachineDetail machine={machine} day={day} /> : <section className={signalPanelClass} />}
    </div>
  );
}
