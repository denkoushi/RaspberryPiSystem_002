import { useEffect, useMemo, useState } from 'react';

import { getApiErrorMessage } from '../../../api/errors';
import { useMachineSignalSettings, useUpdateMachineSignalSettings } from '../../../api/hooks';
import {
  buildSensorTimeline,
  computeSensorDayBase,
  countSensorHints,
  minuteToTimeText,
  timeTextToMinute,
  type SensorHintKey
} from '../machineSignalAdminModel';
import { formatSignalLimit } from '../machineSignalViewModel';

import type { MachineSignalSensor, MachineSignalThresholds } from '../../../api/client';

const DAY_MINUTES = 1_440;
/** 入力欄の単位。保存は秒・回・% で行う。 */
const SCALE: Record<keyof MachineSignalThresholds, number> = {
  shortStopMaxSeconds: 60,
  longStopMinSeconds: 60,
  shortStopCountForHint: 1,
  alarmSecondsForHint: 60,
  alarmCountForHint: 1,
  barelyRanMaxSeconds: 60,
  goodRunMinSeconds: 3_600,
  worseningPercent: 1
};
const LABELS: Record<keyof MachineSignalThresholds, string> = {
  shortStopMaxSeconds: '短い停止の上限（分）',
  longStopMinSeconds: '長い停止の下限（分）',
  shortStopCountForHint: 'チョコ停 多 にする短い停止の回数',
  alarmSecondsForHint: '異常 多 にする赤ランプの合計（分）',
  alarmCountForHint: '異常 多 にする赤ランプの回数',
  barelyRanMaxSeconds: 'ほぼ停止 にする稼働の上限（分）',
  goodRunMinSeconds: '良好 にする稼働の下限（時間）',
  worseningPercent: '悪化 とする変化（%）'
};

/** 対数の目盛りでの位置（1分〜24時間を 0〜100%）。 */
const rulerPosition = (seconds: number) => (Math.log(Math.max(1, seconds / 60)) / Math.log(DAY_MINUTES)) * 100;

/** 判定の設定。条件の横に、最新の日報で何台が該当するかをその場で出す。 */
export function ThresholdPanel({ sensors, onSaved }: { sensors: MachineSignalSensor[]; onSaved: (message: string) => void }) {
  const settings = useMachineSignalSettings();
  const update = useUpdateMachineSignalSettings();
  const [draft, setDraft] = useState<MachineSignalThresholds | null>(null);
  const [night, setNight] = useState('');

  useEffect(() => {
    if (!settings.data) return;
    setDraft(settings.data.thresholds);
    setNight(minuteToTimeText(settings.data.nightStartMinute));
  }, [settings.data]);

  const bases = useMemo(
    () => sensors.filter((sensor) => !sensor.hidden).map((sensor) => computeSensorDayBase(buildSensorTimeline(sensor, sensor.categoryOverrides))),
    [sensors]
  );
  const counts = useMemo(() => (draft ? countSensorHints(bases, draft) : null), [bases, draft]);
  const latestDate = sensors.find((sensor) => sensor.latestReportDate)?.latestReportDate ?? null;

  if (!draft) {
    return (
      <aside className="card insp">
        <div className="ih">
          <h2>判定の設定</h2>
        </div>
        <div className="ib">
          <p className="note">{settings.isError ? '読み込めませんでした' : '読み込み中…'}</p>
        </div>
      </aside>
    );
  }

  const nightMinute = timeTextToMinute(night);
  const orderValid = draft.longStopMinSeconds > draft.shortStopMaxSeconds;
  const field = (key: keyof MachineSignalThresholds, width = 62) => (
    <input
      className="in n"
      style={{ width }}
      inputMode="decimal"
      aria-label={LABELS[key]}
      defaultValue={draft[key] / SCALE[key]}
      key={`${key}-${settings.dataUpdatedAt}`}
      onChange={(event) => {
        const value = Number(event.target.value);
        if (event.target.value.trim() === '' || !Number.isFinite(value) || value <= 0) return;
        setDraft((previous) => (previous ? { ...previous, [key]: Math.round(value * SCALE[key]) } : previous));
      }}
    />
  );
  const count = (key: SensorHintKey) => (
    <span className="cnt">
      <b>{counts?.[key] ?? 0}</b>台
    </span>
  );
  const shortAt = rulerPosition(draft.shortStopMaxSeconds);
  const longAt = Math.max(shortAt, rulerPosition(draft.longStopMinSeconds));

  return (
    <aside className="card insp">
      <div className="ih">
        <h2>
          判定の設定<small>全センサー共通</small>
        </h2>
      </div>
      <div className="ib">
        <div>
          <h3>停止の長さの区切り</h3>
          <div className="ruler" aria-hidden="true">
            <i style={{ width: `${shortAt}%`, background: 'var(--s1)' }}>短い</i>
            <i style={{ width: `${longAt - shortAt}%`, background: 'var(--s2)' }}>中間</i>
            <i style={{ flex: 1, background: 'var(--s3)', color: '#fff' }}>長い</i>
          </div>
          <div className="ticks" aria-hidden="true">
            <i style={{ left: 0 }}>1分</i>
            <i style={{ left: `${shortAt}%` }}>{formatSignalLimit(draft.shortStopMaxSeconds)}</i>
            <i style={{ left: `${longAt}%` }}>{formatSignalLimit(draft.longStopMinSeconds)}</i>
            <i style={{ left: '100%' }}>24時間</i>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="unit">短い停止は</span>
            {field('shortStopMaxSeconds')}
            <span className="unit">分まで</span>
            <span className="unit" style={{ marginLeft: 10 }}>
              長い停止は
            </span>
            {field('longStopMinSeconds', 70)}
            <span className="unit">分から</span>
          </div>
          {!orderValid ? <p className="err">長い停止の下限は、短い停止の上限より長くしてください</p> : null}
        </div>

        <div>
          <h3>気づきの条件{latestDate ? ` ・ ${latestDate} に該当する台数` : ''}</h3>
          <div className="rule">
            <span className="hint h0">異常 多</span>
            <div className="row">
              <span className="unit">赤ランプが合計</span>
              {field('alarmSecondsForHint')}
              <span className="unit">分以上、または</span>
              {field('alarmCountForHint')}
              <span className="unit">回以上</span>
            </div>
            {count('ALARM')}
          </div>
          <div className="rule">
            <span className="hint h1">チョコ停 多</span>
            <div className="row">
              <span className="unit">短い停止が</span>
              {field('shortStopCountForHint')}
              <span className="unit">回以上</span>
            </div>
            {count('SHORT_STOPS')}
          </div>
          <div className="rule">
            <span className="hint h3">ほぼ停止</span>
            <div className="row">
              <span className="unit">稼働が</span>
              {field('barelyRanMaxSeconds')}
              <span className="unit">分未満</span>
            </div>
            {count('BARELY_RAN')}
          </div>
          <div className="rule">
            <span className="hint h2">長時間停止</span>
            <div className="row">
              <span className="unit">長い停止が1回以上</span>
            </div>
            {count('LONG_STOP')}
          </div>
          <div className="rule">
            <span className="hint h6">良好</span>
            <div className="row">
              <span className="unit">稼働が</span>
              {field('goodRunMinSeconds')}
              <span className="unit">時間以上で、上のどれでもない</span>
            </div>
            {count('GOOD')}
          </div>
          <div className="rule">
            <span className="hint h7">悪化</span>
            <div className="row">
              <span className="unit">直近7日が前の28日より</span>
              {field('worseningPercent')}
              <span className="unit">%以上悪い</span>
            </div>
            <span className="cnt">全体ページに表示</span>
          </div>
        </div>

        <div className="fld">
          <label htmlFor="msa-night">夜の開始</label>
          <input id="msa-night" className="in t num" type="time" value={night} onChange={(event) => setNight(event.target.value)} />
        </div>
      </div>
      <div className="if">
        <button
          className="btn pri"
          type="button"
          disabled={update.isPending || nightMinute === null || !orderValid}
          onClick={() => {
            if (nightMinute === null) return;
            update.mutate({ nightStartMinute: nightMinute, thresholds: draft }, { onSuccess: () => onSaved('保存しました') });
          }}
        >
          {update.isPending ? '保存中…' : '保存'}
        </button>
        {update.error ? (
          <span className="err" role="alert">
            {getApiErrorMessage(update.error, '保存に失敗しました')}
          </span>
        ) : (
          <span className="note">保存すると、キオスクはすぐ新しい条件で計算し直します</span>
        )}
      </div>
    </aside>
  );
}
