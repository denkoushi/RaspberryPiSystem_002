import clsx from 'clsx';
import { useMemo, useState } from 'react';

import { getApiErrorMessage } from '../../../api/errors';
import { useUpdateMachineSignalSensor, useUpdateMachineSignalSensorsBulk } from '../../../api/hooks';
import { buildSensorTimeline, minuteToTimeText, numberOrNull, timeTextToMinute } from '../machineSignalAdminModel';
import { buildSignalAxisTicks, SIGNAL_CATEGORY_COLORS, SIGNAL_CATEGORY_LABELS } from '../machineSignalViewModel';
import { SignalBand } from '../SignalBand';

import { SENSOR_KIND_LABELS } from './SensorBoard';

import type {
  MachineSignalCategory,
  MachineSignalSensor,
  MachineSignalSensorBulkPatch,
  MachineSignalSensorKind
} from '../../../api/client';
import type { ReactNode } from 'react';

const KINDS = Object.keys(SENSOR_KIND_LABELS) as MachineSignalSensorKind[];
const CATEGORIES: MachineSignalCategory[] = ['RUN', 'RUN_ALARM', 'STOP', 'ALARM_STOP', 'IDLE'];
const LAMP_TITLES: Record<string, string> = { '0': '判定に使わない', '1': '消灯', '2': '点灯', '4': '点滅' };
const DEFAULT_PLAN = { from: '08:00', to: '20:00' };

function LampDot({ code, colour }: { code: string; colour: 'r' | 'y' | 'g' }) {
  return (
    <span
      className={clsx('dot', colour, code === '2' && 'on', code === '4' && 'on bl', code === '0' && 'any')}
      title={LAMP_TITLES[code]}
    />
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SiteField({ sites, value, onChange }: { sites: string[]; value: string | null; onChange: (site: string) => void }) {
  const [adding, setAdding] = useState('');
  const options = value && !sites.includes(value) ? [...sites, value] : sites;
  return (
    <>
      <span className="l">工場</span>
      <div className="row">
        {options.length > 0 ? (
          <Segmented
            label="工場"
            options={options.map((site) => ({ value: site, label: site }))}
            value={value}
            onChange={(site) => onChange(site === value ? '' : site)}
          />
        ) : null}
        <input
          className="in"
          style={{ width: 120 }}
          placeholder="＋ 追加"
          aria-label="工場を追加"
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !adding.trim()) return;
            event.preventDefault();
            onChange(adding.trim());
            setAdding('');
          }}
        />
      </div>
    </>
  );
}

function PlanField({
  mode,
  from,
  to,
  onMode,
  onFrom,
  onTo
}: {
  mode: 'all' | 'set' | null;
  from: string;
  to: string;
  onMode: (mode: 'all' | 'set') => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <>
      <span className="l">稼働予定</span>
      <div className="row">
        <Segmented
          label="稼働予定"
          options={[
            { value: 'all', label: '終日' },
            { value: 'set', label: '時間を決める' }
          ]}
          value={mode}
          onChange={onMode}
        />
        {mode === 'set' ? (
          <>
            <input className="in t num" type="time" aria-label="稼働予定 開始" value={from} onChange={(event) => onFrom(event.target.value)} />
            <span className="unit">〜</span>
            <input className="in t num" type="time" aria-label="稼働予定 終了" value={to} onChange={(event) => onTo(event.target.value)} />
          </>
        ) : null}
      </div>
    </>
  );
}

function Shell({
  title,
  note,
  saving,
  canSave,
  error,
  onSave,
  onClose,
  children
}: {
  title: ReactNode;
  note: ReactNode;
  saving: boolean;
  canSave: boolean;
  error: unknown;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="ih">
        <h2>
          {title}
          <small>{note}</small>
        </h2>
        <button className="btn pri sm" type="button" onClick={onSave} disabled={saving || !canSave}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="x" type="button" aria-label="閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="ib">
        {error ? (
          <p className="err" role="alert">
            {getApiErrorMessage(error, '保存に失敗しました')}
          </p>
        ) : null}
        {children}
      </div>
    </>
  );
}

/** 1台の編集。表示名・工場・種別・稼働予定・電力・ランプの読み替え。読み替えは上の帯にその場で反映する。 */
export function SingleSensorEditor({
  sensor,
  sites,
  onClose,
  onSaved
}: {
  sensor: MachineSignalSensor;
  sites: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const update = useUpdateMachineSignalSensor();
  const [displayName, setDisplayName] = useState(sensor.displayName ?? '');
  const [site, setSite] = useState(sensor.site ?? '');
  const [kind, setKind] = useState(sensor.kind);
  const [hidden, setHidden] = useState(sensor.hidden);
  const [planMode, setPlanMode] = useState<'all' | 'set'>(sensor.plannedStartMinute === null ? 'all' : 'set');
  const [from, setFrom] = useState(minuteToTimeText(sensor.plannedStartMinute) || DEFAULT_PLAN.from);
  const [to, setTo] = useState(minuteToTimeText(sensor.plannedEndMinute) || DEFAULT_PLAN.to);
  const [runningKw, setRunningKw] = useState(sensor.runningKw === null ? '' : String(sensor.runningKw));
  const [idleKw, setIdleKw] = useState(sensor.idleKw === null ? '' : String(sensor.idleKw));
  const [overrides, setOverrides] = useState<Record<string, MachineSignalCategory>>({ ...sensor.categoryOverrides });
  const timeline = useMemo(() => buildSensorTimeline(sensor, overrides), [sensor, overrides]);
  const planValid = planMode === 'all' || (timeTextToMinute(from) !== null && timeTextToMinute(to) !== null);

  const save = async () => {
    await update.mutateAsync({
      signalNo: sensor.signalNo,
      input: {
        displayName: displayName.trim() || null,
        site: site.trim() || null,
        kind,
        hidden,
        plannedStartMinute: planMode === 'set' ? timeTextToMinute(from) : null,
        plannedEndMinute: planMode === 'set' ? timeTextToMinute(to) : null,
        runningKw: numberOrNull(runningKw),
        idleKw: numberOrNull(idleKw),
        categoryOverrides: overrides
      }
    });
    onSaved('保存しました');
  };

  return (
    <Shell
      title={displayName.trim() || sensor.sourceMachineName}
      note={
        <>
          Signal <span className="num">{sensor.signalNo}</span>
          {displayName.trim() ? ` ・ ${sensor.sourceMachineName}` : ''}
        </>
      }
      saving={update.isPending}
      canSave={planValid}
      error={update.error}
      onSave={() => void save()}
      onClose={onClose}
    >
      <div>
        <h3>{sensor.latestReportDate ? `${sensor.latestReportDate} の24時間（読み替えを反映）` : '最新の24時間'}</h3>
        {timeline.length > 0 ? (
          <>
            <SignalBand timeline={timeline} tone="light" label={`${sensor.sourceMachineName} の最新の24時間`} />
            <div className="axis" aria-hidden="true">
              {buildSignalAxisTicks(480).map((tick, index) => (
                <i key={index} style={{ left: `${tick.position * 100}%` }}>
                  {tick.label}
                </i>
              ))}
            </div>
          </>
        ) : (
          <p className="note">記録なし</p>
        )}
      </div>

      <div className="fld">
        <label htmlFor="msa-display-name">表示名</label>
        <input
          id="msa-display-name"
          className="in w"
          value={displayName}
          placeholder={sensor.sourceMachineName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <SiteField sites={sites} value={site || null} onChange={setSite} />
        <span className="l">種別</span>
        <Segmented label="種別" options={KINDS.map((value) => ({ value, label: SENSOR_KIND_LABELS[value] }))} value={kind} onChange={setKind} />
        <PlanField mode={planMode} from={from} to={to} onMode={setPlanMode} onFrom={setFrom} onTo={setTo} />
        <span className="l">電力</span>
        <div className="row">
          <span className="unit">稼働中</span>
          <input className="in n" inputMode="decimal" aria-label="稼働中の電力（kW）" value={runningKw} onChange={(event) => setRunningKw(event.target.value)} />
          <span className="unit">kW</span>
          <span className="unit" style={{ marginLeft: 8 }}>
            停止中
          </span>
          <input className="in n" inputMode="decimal" aria-label="停止中の電力（kW）" value={idleKw} onChange={(event) => setIdleKw(event.target.value)} />
          <span className="unit">kW</span>
        </div>
        <span className="l">キオスク</span>
        <Segmented
          label="キオスクに出す"
          options={[
            { value: 'show', label: '表示する' },
            { value: 'hide', label: '出さない' }
          ]}
          value={hidden ? 'hide' : 'show'}
          onChange={(value) => setHidden(value === 'hide')}
        />
      </div>

      {sensor.lampPatterns.length > 0 ? (
        <div>
          <h3>ランプの読み替え</h3>
          {sensor.lampPatterns.map((lamp) => {
            const current = overrides[lamp.pattern] ?? lamp.autoCategory;
            const states = lamp.stateNames.join(' / ');
            return (
              <div className="lamp" key={lamp.pattern}>
                <span className="dots">
                  <LampDot code={lamp.pattern[0]} colour="r" />
                  <LampDot code={lamp.pattern[1]} colour="y" />
                  <LampDot code={lamp.pattern[2]} colour="g" />
                </span>
                <span className="st" title={states}>
                  {states}
                </span>
                <span className="cat" role="group" aria-label={`${states} の区分`}>
                  {CATEGORIES.map((category, index) => {
                    const pressed = current === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        aria-pressed={pressed}
                        data-auto={lamp.autoCategory === category ? '' : undefined}
                        style={pressed ? { background: SIGNAL_CATEGORY_COLORS[index], color: index === 2 ? '#3d3206' : undefined } : undefined}
                        onClick={() =>
                          setOverrides((previous) => {
                            const next = { ...previous };
                            if (category === lamp.autoCategory) delete next[lamp.pattern];
                            else next[lamp.pattern] = category;
                            return next;
                          })
                        }
                      >
                        {SIGNAL_CATEGORY_LABELS[index]}
                      </button>
                    );
                  })}
                </span>
              </div>
            );
          })}
          <p className="note" style={{ margin: '8px 0 0' }}>
            <b />
            ランプ色から自動で決めた区分
          </p>
        </div>
      ) : null}
    </Shell>
  );
}

/** 複数台をまとめて設定する。押した項目だけを変え、触っていない項目は各センサーの値を残す。 */
export function BulkSensorEditor({
  signalNos,
  sites,
  onClose,
  onSaved
}: {
  signalNos: number[];
  sites: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const update = useUpdateMachineSignalSensorsBulk();
  const [site, setSite] = useState<string | null>(null);
  const [kind, setKind] = useState<MachineSignalSensorKind | null>(null);
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [planMode, setPlanMode] = useState<'all' | 'set' | null>(null);
  const [from, setFrom] = useState(DEFAULT_PLAN.from);
  const [to, setTo] = useState(DEFAULT_PLAN.to);

  const patch: MachineSignalSensorBulkPatch = {};
  if (site !== null) patch.site = site || null;
  if (kind !== null) patch.kind = kind;
  if (hidden !== null) patch.hidden = hidden;
  const startMinute = timeTextToMinute(from);
  const endMinute = timeTextToMinute(to);
  if (planMode === 'all') patch.planned = null;
  if (planMode === 'set' && startMinute !== null && endMinute !== null) patch.planned = { startMinute, endMinute };
  const planValid = planMode !== 'set' || (startMinute !== null && endMinute !== null);

  const save = async () => {
    const updated = await update.mutateAsync({ signalNos, patch });
    onSaved(`${updated}台を保存しました`);
  };

  return (
    <Shell
      title={
        <>
          <span className="num">{signalNos.length}</span>台をまとめて設定
        </>
      }
      note="押した項目だけ変わります"
      saving={update.isPending}
      canSave={planValid && Object.keys(patch).length > 0}
      error={update.error}
      onSave={() => void save()}
      onClose={onClose}
    >
      <div className="fld">
        <SiteField sites={sites} value={site} onChange={setSite} />
        <span className="l">種別</span>
        <Segmented label="種別" options={KINDS.map((value) => ({ value, label: SENSOR_KIND_LABELS[value] }))} value={kind} onChange={setKind} />
        <PlanField mode={planMode} from={from} to={to} onMode={setPlanMode} onFrom={setFrom} onTo={setTo} />
        <span className="l">キオスク</span>
        <Segmented
          label="キオスクに出す"
          options={[
            { value: 'show', label: '表示する' },
            { value: 'hide', label: '出さない' }
          ]}
          value={hidden === null ? null : hidden ? 'hide' : 'show'}
          onChange={(value) => setHidden(value === 'hide')}
        />
      </div>
    </Shell>
  );
}
