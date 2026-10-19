import clsx from 'clsx';
import { useMemo } from 'react';

import { buildSensorTimeline } from '../machineSignalAdminModel';
import { SignalBand } from '../SignalBand';

import type { MachineSignalSensor, MachineSignalSensorKind } from '../../../api/client';

export const SENSOR_KIND_LABELS: Record<MachineSignalSensorKind, string> = {
  MACHINE: '加工機',
  ROBOT: 'ロボット',
  LINE: 'ライン',
  OTHER: 'その他'
};

export const FILTER_ALL = 'all';
export const FILTER_TODO = 'todo';

function Row({
  sensor,
  selected,
  anchored,
  onOpen,
  onToggle
}: {
  sensor: MachineSignalSensor;
  selected: boolean;
  anchored: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const name = sensor.displayName ?? sensor.sourceMachineName;
  const timeline = useMemo(() => buildSensorTimeline(sensor, sensor.categoryOverrides), [sensor]);
  return (
    <div className="cellw">
      <input type="checkbox" className="ck" checked={selected} onChange={onToggle} aria-label={`${name} をまとめて選ぶ`} />
      <button
        type="button"
        className={clsx('cell', sensor.hidden && 'off', anchored && 'anchor')}
        aria-pressed={selected}
        data-signal-row={sensor.signalNo}
        onClick={onOpen}
      >
        <span className="no">{sensor.signalNo}</span>
        <span className="nm">
          {name}
          {sensor.kind !== 'MACHINE' ? <s>{SENSOR_KIND_LABELS[sensor.kind]}</s> : null}
        </span>
        <SignalBand timeline={timeline} tone="light" label={`${name} の最新の24時間`} />
        {sensor.site ? <span className="tag site">{sensor.site}</span> : <span className="todo" title="工場 未設定" />}
      </button>
    </div>
  );
}

/** 全センサーを1画面で見渡す盤。行を押すと1台の編集、左のチェックでまとめて設定する台を選ぶ。 */
export function SensorBoard({
  sensors,
  sites,
  filter,
  onFilter,
  selected,
  anchor,
  onOpen,
  onToggle,
  onPickTodo,
  onClear,
  pickTodoRef
}: {
  sensors: MachineSignalSensor[];
  sites: string[];
  filter: string;
  onFilter: (filter: string) => void;
  selected: ReadonlySet<number>;
  anchor: number | 'todo' | null;
  onOpen: (signalNo: number) => void;
  onToggle: (signalNo: number) => void;
  onPickTodo: () => void;
  onClear: () => void;
  pickTodoRef: React.RefObject<HTMLButtonElement>;
}) {
  const todoCount = sensors.filter((sensor) => !sensor.site).length;
  const filters = [
    { key: FILTER_ALL, label: 'すべて', count: sensors.length },
    { key: FILTER_TODO, label: '工場 未設定', count: todoCount },
    ...sites.map((site) => ({ key: site, label: site, count: sensors.filter((sensor) => sensor.site === site).length }))
  ];
  const shown = sensors.filter((sensor) =>
    filter === FILTER_ALL ? true : filter === FILTER_TODO ? !sensor.site : sensor.site === filter
  );

  return (
    <section className="card">
      <div className="bar">
        <div role="group" aria-label="絞り込み" style={{ display: 'contents' }}>
          {filters.map((item) => (
            <button key={item.key} type="button" className="chip" aria-pressed={filter === item.key} onClick={() => onFilter(item.key)}>
              {item.label}
              <b>{item.count}</b>
            </button>
          ))}
        </div>
        <span className="sp" />
        <button ref={pickTodoRef} className="link" type="button" onClick={onPickTodo} disabled={todoCount === 0}>
          未設定をすべて選ぶ
        </button>
        {selected.size > 0 ? (
          <button className="link" type="button" onClick={onClear}>
            選択を解除
          </button>
        ) : null}
      </div>
      <div className="grid">
        {sensors.length === 0 ? <p className="note">日報を取り込むと、センサーがここに並びます。</p> : null}
        {shown.map((sensor) => (
          <Row
            key={sensor.signalNo}
            sensor={sensor}
            selected={selected.has(sensor.signalNo)}
            anchored={anchor === sensor.signalNo && selected.size > 0}
            onOpen={() => onOpen(sensor.signalNo)}
            onToggle={() => onToggle(sensor.signalNo)}
          />
        ))}
      </div>
    </section>
  );
}
