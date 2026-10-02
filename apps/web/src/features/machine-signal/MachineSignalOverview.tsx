import clsx from 'clsx';

import {
  buildSignalAxisTicks,
  buildSignalLossSlices,
  describeSignalWorsening,
  formatSignalClock,
  formatSignalDuration,
  formatSignalHours,
  formatSignalLimit,
  SIGNAL_FILTER_HINTS,
  SIGNAL_HINT_CLASSES,
  SIGNAL_HINT_LABELS
} from './machineSignalViewModel';
import { signalPanelClass } from './signalUi';

import type { MachineSignalDay, MachineSignalFleetDay, MachineSignalMachineDay } from '../../api/client';

const CHART_WIDTH = 600;
const CHART_HEIGHT = 190;
const CHART_LEFT = 30;
const CHART_BOTTOM = 22;
const CHART_TOP = 8;

function RunningCountChart({ fleet, dayStartMinute }: { fleet: MachineSignalFleetDay; dayStartMinute: number }) {
  const bins = fleet.runningBins;
  const plotWidth = CHART_WIDTH - CHART_LEFT - 4;
  const plotHeight = CHART_HEIGHT - CHART_BOTTOM - CHART_TOP;
  const yMax = Math.max(10, Math.ceil(Math.max(...bins, 0) / 10) * 10);
  const x = (index: number) => CHART_LEFT + ((index + 0.5) / bins.length) * plotWidth;
  const y = (value: number) => CHART_TOP + plotHeight - (value / yMax) * plotHeight;
  const line = bins.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join('');
  const baseline = CHART_TOP + plotHeight;
  const gridValues = Array.from({ length: yMax / 10 + 1 }, (_, index) => index * 10);

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="block h-auto w-full" role="img" aria-label="時刻ごとの稼働台数">
      {gridValues.map((value) => (
        <g key={value}>
          <line x1={CHART_LEFT} x2={CHART_LEFT + plotWidth} y1={y(value)} y2={y(value)} stroke="#243347" strokeWidth={1} />
          <text x={CHART_LEFT - 6} y={y(value) + 4} textAnchor="end" fontSize={12} fill="#8b9cb2" fontFamily="ui-monospace,monospace">
            {value}
          </text>
        </g>
      ))}
      {buildSignalAxisTicks(dayStartMinute).map((tick, index, ticks) => (
        <text
          key={index}
          x={CHART_LEFT + tick.position * plotWidth}
          y={CHART_HEIGHT - 5}
          textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
          fontSize={12}
          fill="#8b9cb2"
          fontFamily="ui-monospace,monospace"
        >
          {tick.label}
        </text>
      ))}
      <path d={`${line}L${x(bins.length - 1).toFixed(1)},${baseline}L${x(0).toFixed(1)},${baseline}Z`} fill="rgba(53,179,126,0.28)" />
      <path d={line} fill="none" stroke="#35b37e" strokeWidth={2} />
    </svg>
  );
}

type Pick = { machine: MachineSignalMachineDay; amount: number; value: string; detail: string };

function PickPanel({
  title,
  note,
  picks,
  color,
  onSelect
}: {
  title: string;
  note: string;
  picks: Pick[];
  color: string;
  onSelect: (signalNo: number) => void;
}) {
  const max = Math.max(1, ...picks.map((pick) => pick.amount));
  return (
    <section className={clsx(signalPanelClass, 'px-4 py-3')}>
      <div className="mb-2 flex items-baseline justify-between gap-2.5">
        <h2 className="text-base font-bold">{title}</h2>
        <span className="text-sm text-[#8b9cb2]">{note}</span>
      </div>
      {picks.length === 0 ? <p className="text-sm text-[#8b9cb2]">なし</p> : null}
      {picks.map((pick) => (
        <button
          key={pick.machine.signalNo}
          type="button"
          onClick={() => onSelect(pick.machine.signalNo)}
          className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-t border-[#1b2736] py-[7px] text-left hover:bg-[#18232f]"
        >
          <span className="truncate text-[15px] font-semibold">{pick.machine.name}</span>
          <span className="font-mono text-[17px] font-semibold">{pick.value}</span>
          <span className="col-span-2 h-[5px] overflow-hidden rounded-[3px] bg-[#1a2533]">
            <span className="block h-full" style={{ width: `${(pick.amount / max) * 100}%`, backgroundColor: color }} />
          </span>
          <span className="col-span-2 truncate text-xs text-[#8b9cb2]">{pick.detail}</span>
        </button>
      ))}
    </section>
  );
}

/** 全体ページ。1日の結論（時間の行き先、稼働台数、手を打つ機械）を1画面に出す。 */
export function MachineSignalOverview({ day, onSelect }: { day: MachineSignalDay; onSelect: (signalNo: number) => void }) {
  const fleet = day.fleet;
  if (!fleet) return null;
  const byNo = new Map(day.machines.map((machine) => [machine.signalNo, machine]));
  const resolve = (signalNos: number[]) =>
    signalNos.map((signalNo) => byNo.get(signalNo)).filter((machine): machine is MachineSignalMachineDay => !!machine);
  const slices = buildSignalLossSlices(fleet.loss, day.thresholds);
  const tiles = [...day.machines].sort((a, b) => a.signalNo - b.signalNo);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
      <section className={clsx(signalPanelClass, 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-7 gap-y-2 px-4 py-3')}>
        <div>
          <div className="font-mono text-[64px] font-semibold leading-none text-[#35b37e]">
            {Math.round(fleet.runRatio * 100)}
            <small className="ml-0.5 text-2xl">%</small>
          </div>
          <div className="mt-1.5 text-[13px] text-[#8b9cb2]">
            {fleet.machineCount}台 × 24時間のうち稼働
            {fleet.estimatedKwh !== null ? ` ・ 推定 ${Math.round(fleet.estimatedKwh).toLocaleString()} kWh` : ''}
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex h-[34px] gap-0.5 overflow-hidden rounded-[5px]">
            {slices.map((slice) => (
              <span
                key={slice.key}
                title={slice.label}
                className={clsx('block min-w-[2px]', slice.key === 'noRecordSeconds' && 'outline outline-1 -outline-offset-1 outline-[#243347]')}
                style={{ flex: `${slice.seconds} 0 0`, backgroundColor: slice.color }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-[22px] gap-y-1.5 text-sm">
            {slices.map((slice) => (
              <span key={slice.key}>
                <i
                  className={clsx('mr-1.5 inline-block h-[11px] w-[11px] rounded-sm align-[-1px]', slice.key === 'noRecordSeconds' && 'outline outline-1 outline-[#243347]')}
                  style={{ backgroundColor: slice.color }}
                />
                {slice.label}
                <b className="ml-1.5 font-mono">{formatSignalHours(slice.seconds)}</b>
                <small className="ml-1 text-[#8b9cb2]">時間 {Math.round(slice.ratio * 100)}%</small>
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-2.5 min-[1100px]:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
        <section className={clsx(signalPanelClass, 'px-4 py-3')}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 className="text-base font-bold">動いていた台数</h2>
            <span className="text-sm text-[#8b9cb2]">
              {fleet.dayAverage !== null ? (
                <>
                  昼 平均<b className="mx-0.5 font-mono text-lg text-[#e6edf5]">{fleet.dayAverage.toFixed(0)}</b>台
                </>
              ) : null}
              {fleet.nightAverage !== null ? (
                <>
                  <span className="ml-3">夜</span> {formatSignalClockOfMinute(day.nightStartMinute)}〜 平均
                  <b className="mx-0.5 font-mono text-lg text-[#e6edf5]">{fleet.nightAverage.toFixed(0)}</b>台
                </>
              ) : null}
            </span>
          </div>
          <RunningCountChart fleet={fleet} dayStartMinute={day.dayStartMinute} />
        </section>
        <PickPanel
          title="赤ランプが長い"
          note={`${day.machines.filter((machine) => machine.alarmSeconds > 0).length}台`}
          color="#ef5350"
          onSelect={onSelect}
          picks={resolve(fleet.topAlarm).map((machine) => ({
            machine,
            amount: machine.alarmSeconds,
            value: formatSignalDuration(machine.alarmSeconds),
            detail: `${machine.alarmCount}回`
          }))}
        />
        <PickPanel
          title="細かく止まる"
          note={`${formatSignalLimit(day.thresholds.shortStopMaxSeconds)}以下`}
          color="#f3e7a0"
          onSelect={onSelect}
          picks={resolve(fleet.topShortStops).map((machine) => ({
            machine,
            amount: machine.shortStopCount,
            value: `${machine.shortStopCount}回`,
            detail: `連続平均 ${formatSignalDuration(machine.averageRunSeconds)}`
          }))}
        />
        <PickPanel
          title="長く止まった"
          note="1回の最長"
          color="#a58c2a"
          onSelect={onSelect}
          picks={resolve(fleet.topLongStop).map((machine) => {
            const stop = machine.longestStops[0];
            return {
              machine,
              amount: stop.durationSeconds,
              value: formatSignalDuration(stop.durationSeconds),
              detail: `${formatSignalClock(stop.startSecond, day.dayStartMinute)}から ・ ${stop.stateName}`
            };
          })}
        />
      </div>

      {fleet.worsening.length > 0 ? (
        <section className={clsx(signalPanelClass, 'px-4 py-3')}>
          <div className="mb-2 flex items-baseline justify-between gap-2.5">
            <h2 className="text-base font-bold">悪くなってきた機械</h2>
            <span className="text-sm text-[#8b9cb2]">直近7日と、その前の28日</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1.5">
            {fleet.worsening.map((worsening) => {
              const machine = byNo.get(worsening.signalNo);
              if (!machine) return null;
              const text = describeSignalWorsening(worsening);
              return (
                <button
                  key={worsening.signalNo}
                  type="button"
                  onClick={() => onSelect(worsening.signalNo)}
                  className="grid min-w-0 gap-0.5 rounded-md bg-[#3a2a12] px-2.5 py-[7px] text-left text-[#f6c98a]"
                >
                  <span className="truncate text-[15px] font-semibold">{machine.name}</span>
                  <span className="text-[13px]">
                    {text.title} <span className="ml-1 font-mono">{text.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className={clsx(signalPanelClass, 'px-4 py-3')}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 className="text-base font-bold">全機械</h2>
          <span className="text-sm text-[#8b9cb2]">
            {SIGNAL_FILTER_HINTS.map((hint) => (
              <span key={hint} className="ml-3">
                {SIGNAL_HINT_LABELS[hint]}
                <b className="ml-0.5 font-mono text-lg text-[#e6edf5]">{fleet.hintCounts[hint]}</b>
              </span>
            ))}
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
          {tiles.map((machine) => (
            <button
              key={machine.signalNo}
              type="button"
              onClick={() => onSelect(machine.signalNo)}
              className={clsx('grid min-w-0 gap-0.5 rounded-md px-[9px] py-[7px] text-left', SIGNAL_HINT_CLASSES[machine.hint])}
            >
              <span className="truncate text-[13px] font-semibold">{machine.name}</span>
              <span className="font-mono text-base font-semibold">
                {machine.hasRecord ? `${formatSignalHours(machine.runSeconds)}h` : '–'}
                <small className="ml-1.5 font-sans text-[11px] font-medium opacity-85">{SIGNAL_HINT_LABELS[machine.hint]}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatSignalClockOfMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
