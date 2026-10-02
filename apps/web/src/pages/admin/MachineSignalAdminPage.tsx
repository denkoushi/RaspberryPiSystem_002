import { useEffect, useRef, useState } from 'react';

import { uploadMachineSignalReports } from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import {
  useInvalidateMachineSignal,
  useMachineSignalImportRuns,
  useMachineSignalSensors,
  useMachineSignalSettings,
  useRunMachineSignalGmailImport,
  useUpdateMachineSignalSensor,
  useUpdateMachineSignalSettings
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import {
  minuteToTimeText,
  numberOrNull,
  planSignalUpload,
  SIGNAL_THRESHOLD_FIELDS,
  timeTextToMinute
} from '../../features/machine-signal/machineSignalAdminModel';
import { SIGNAL_CATEGORY_LABELS } from '../../features/machine-signal/machineSignalViewModel';

import type {
  MachineSignalCategory,
  MachineSignalSensor,
  MachineSignalSensorKind,
  MachineSignalThresholds
} from '../../api/client';

const KIND_LABELS: Record<MachineSignalSensorKind, string> = {
  MACHINE: '加工機',
  ROBOT: 'ロボット',
  LINE: 'ライン',
  OTHER: 'その他'
};
const CATEGORY_OPTIONS: MachineSignalCategory[] = ['RUN', 'RUN_ALARM', 'STOP', 'ALARM_STOP', 'IDLE'];
const CATEGORY_LABEL = (category: MachineSignalCategory) =>
  SIGNAL_CATEGORY_LABELS[['RUN', 'RUN_ALARM', 'STOP', 'ALARM_STOP', 'IDLE', 'NO_RECORD'].indexOf(category)];
const LAMP_TEXT: Record<string, string> = { '0': '－', '1': '消', '2': '点灯', '4': '点滅' };
const lampPatternText = (pattern: string) => `赤${LAMP_TEXT[pattern[0]]} 黄${LAMP_TEXT[pattern[1]]} 緑${LAMP_TEXT[pattern[2]]}`;
const labelClass = 'text-sm font-semibold text-slate-700';
const selectClass = 'w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-slate-900';

type SensorForm = {
  displayName: string;
  site: string;
  kind: MachineSignalSensorKind;
  hidden: boolean;
  plannedStart: string;
  plannedEnd: string;
  runningKw: string;
  idleKw: string;
  categoryOverrides: Record<string, MachineSignalCategory>;
};

const toForm = (sensor: MachineSignalSensor): SensorForm => ({
  displayName: sensor.displayName ?? '',
  site: sensor.site ?? '',
  kind: sensor.kind,
  hidden: sensor.hidden,
  plannedStart: minuteToTimeText(sensor.plannedStartMinute),
  plannedEnd: minuteToTimeText(sensor.plannedEndMinute),
  runningKw: sensor.runningKw === null ? '' : String(sensor.runningKw),
  idleKw: sensor.idleKw === null ? '' : String(sensor.idleKw),
  categoryOverrides: { ...sensor.categoryOverrides }
});

function SensorEditor({ sensor, sites, onClose }: { sensor: MachineSignalSensor; sites: string[]; onClose: () => void }) {
  const [form, setForm] = useState<SensorForm>(() => toForm(sensor));
  const update = useUpdateMachineSignalSensor();
  const set = <K extends keyof SensorForm>(key: K, value: SensorForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    await update.mutateAsync({
      signalNo: sensor.signalNo,
      input: {
        displayName: form.displayName.trim() || null,
        site: form.site.trim() || null,
        kind: form.kind,
        hidden: form.hidden,
        plannedStartMinute: timeTextToMinute(form.plannedStart),
        plannedEndMinute: timeTextToMinute(form.plannedEnd),
        runningKw: numberOrNull(form.runningKw),
        idleKw: numberOrNull(form.idleKw),
        categoryOverrides: form.categoryOverrides
      }
    });
    onClose();
  };

  return (
    <Card title={`Signal ${sensor.signalNo} ・ ${sensor.sourceMachineName}`}>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={labelClass}>
          表示名
          <Input value={form.displayName} placeholder={sensor.sourceMachineName} onChange={(event) => set('displayName', event.target.value)} />
        </label>
        <label className={labelClass}>
          工場
          <Input value={form.site} list="machine-signal-sites" onChange={(event) => set('site', event.target.value)} />
          <datalist id="machine-signal-sites">
            {sites.map((site) => (
              <option key={site} value={site} />
            ))}
          </datalist>
        </label>
        <label className={labelClass}>
          種別
          <select className={selectClass} value={form.kind} onChange={(event) => set('kind', event.target.value as MachineSignalSensorKind)}>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          稼働予定 開始
          <Input type="time" value={form.plannedStart} onChange={(event) => set('plannedStart', event.target.value)} />
        </label>
        <label className={labelClass}>
          稼働予定 終了
          <Input type="time" value={form.plannedEnd} onChange={(event) => set('plannedEnd', event.target.value)} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={form.hidden} onChange={(event) => set('hidden', event.target.checked)} />
          キオスクに出さない
        </label>
        <label className={labelClass}>
          稼働中の電力（kW）
          <Input inputMode="decimal" value={form.runningKw} onChange={(event) => set('runningKw', event.target.value)} />
        </label>
        <label className={labelClass}>
          停止中の電力（kW）
          <Input inputMode="decimal" value={form.idleKw} onChange={(event) => set('idleKw', event.target.value)} />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-600">稼働予定が空なら終日。予定外の時間は停止に数えません。</p>

      {sensor.lampPatterns.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-slate-900">ランプの読み替え</h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-1 pr-3">ランプ</th>
                <th className="py-1 pr-3">センサー側の状態名</th>
                <th className="py-1">区分</th>
              </tr>
            </thead>
            <tbody>
              {sensor.lampPatterns.map((lamp) => (
                <tr key={lamp.pattern} className="border-t border-slate-200">
                  <td className="py-1 pr-3 font-mono">{lampPatternText(lamp.pattern)}</td>
                  <td className="py-1 pr-3">{lamp.stateNames.join(' / ')}</td>
                  <td className="py-1">
                    <select
                      aria-label={`${lampPatternText(lamp.pattern)} の区分`}
                      className={selectClass}
                      value={form.categoryOverrides[lamp.pattern] ?? ''}
                      onChange={(event) => {
                        const next = { ...form.categoryOverrides };
                        if (event.target.value) next[lamp.pattern] = event.target.value as MachineSignalCategory;
                        else delete next[lamp.pattern];
                        set('categoryOverrides', next);
                      }}
                    >
                      <option value="">自動（{CATEGORY_LABEL(lamp.autoCategory)}）</option>
                      {CATEGORY_OPTIONS.map((category) => (
                        <option key={category} value={category}>
                          {CATEGORY_LABEL(category)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {update.error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-700">
          {getApiErrorMessage(update.error, '保存に失敗しました')}
        </p>
      ) : null}
      <div className="mt-4">
        <Button type="button" onClick={() => void save()} disabled={update.isPending}>
          {update.isPending ? '保存中…' : '保存'}
        </Button>
        <Button type="button" variant="ghost" className="ml-3" onClick={onClose}>
          閉じる
        </Button>
      </div>
    </Card>
  );
}

function SettingsCard() {
  const settings = useMachineSignalSettings();
  const update = useUpdateMachineSignalSettings();
  const [nightStart, setNightStart] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!settings.data) return;
    setNightStart(minuteToTimeText(settings.data.nightStartMinute));
    setValues(
      Object.fromEntries(
        SIGNAL_THRESHOLD_FIELDS.map((field) => [field.key, String(settings.data.thresholds[field.key] / field.scale)])
      )
    );
  }, [settings.data]);

  const nightStartMinute = timeTextToMinute(nightStart);
  const parsed = SIGNAL_THRESHOLD_FIELDS.map((field) => ({ field, value: numberOrNull(values[field.key] ?? '') }));
  const valid = nightStartMinute !== null && parsed.every((entry) => entry.value !== null);

  const save = () => {
    if (nightStartMinute === null) return;
    const thresholds = Object.fromEntries(
      parsed.map((entry) => [entry.field.key, Math.round((entry.value ?? 0) * entry.field.scale)])
    ) as MachineSignalThresholds;
    update.mutate({ nightStartMinute, thresholds });
  };

  return (
    <Card title="判定の設定">
      <div className="grid gap-4 md:grid-cols-3">
        <label className={labelClass}>
          夜の開始
          <Input type="time" value={nightStart} onChange={(event) => setNightStart(event.target.value)} />
        </label>
        {SIGNAL_THRESHOLD_FIELDS.map((field) => (
          <label key={field.key} className={labelClass}>
            {field.label}（{field.unit}）
            <Input
              inputMode="decimal"
              value={values[field.key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </label>
        ))}
      </div>
      {update.error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-700">
          {getApiErrorMessage(update.error, '保存に失敗しました')}
        </p>
      ) : null}
      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={save} disabled={!valid || update.isPending}>
          {update.isPending ? '保存中…' : '保存'}
        </Button>
        {update.isSuccess ? <span className="text-sm text-emerald-700">保存しました</span> : null}
      </div>
    </Card>
  );
}

type UploadProgress = { done: number; total: number; imported: number; failed: number; ignored: number; failures: string[] };

function ImportCard() {
  const runs = useMachineSignalImportRuns();
  const gmail = useRunMachineSignalGmailImport();
  const invalidate = useInvalidateMachineSignal();
  const folderInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    // フォルダごと選べるようにする（React の型に無い属性なので直接付ける）。
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const upload = async (selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    const plan = planSignalUpload(Array.from(selected));
    const total = plan.batches.reduce((sum, batch) => sum + batch.length, 0);
    let current: UploadProgress = { done: 0, total, imported: 0, failed: 0, ignored: plan.ignored, failures: [] };
    setProgress(current);
    setUploadError(null);
    setUploading(true);
    try {
      for (const batch of plan.batches) {
        const run = await uploadMachineSignalReports(batch);
        current = {
          ...current,
          done: current.done + batch.length,
          imported: current.imported + run.importedCount,
          failed: current.failed + run.failedCount,
          failures: [...current.failures, ...run.failures.map((failure) => `${failure.fileName}: ${failure.reason}`)].slice(0, 20)
        };
        setProgress(current);
      }
    } catch (error) {
      setUploadError(getApiErrorMessage(error, '取り込みに失敗しました'));
    } finally {
      setUploading(false);
      void invalidate();
    }
  };

  return (
    <Card title="日報の取り込み">
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          フォルダを選ぶ（日付フォルダをまとめて）
          <input
            ref={folderInput}
            type="file"
            multiple
            disabled={uploading}
            className="mt-1 block w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
            onChange={(event) => {
              void upload(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        <label className={labelClass}>
          CSVファイルを選ぶ
          <input
            type="file"
            multiple
            accept=".csv"
            disabled={uploading}
            className="mt-1 block w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
            onChange={(event) => {
              void upload(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-600">同じセンサー・同じ日付は上書きします。日報以外のファイルは送りません。</p>

      {progress ? (
        <div className="mt-3 text-sm text-slate-800" role="status">
          <progress className="block w-full" max={Math.max(1, progress.total)} value={progress.done} />
          <p className="mt-1">
            {progress.done} / {progress.total} 件 ・ 取り込み {progress.imported} ・ 失敗 {progress.failed} ・ 対象外 {progress.ignored}
          </p>
          {progress.failures.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-red-700">
              {progress.failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {uploadError ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
          {uploadError}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => gmail.mutate()} disabled={gmail.isPending}>
          {gmail.isPending ? '確認中…' : 'Gmailを今すぐ確認'}
        </Button>
        {gmail.data ? (
          <span className="text-sm text-slate-800">
            メール {gmail.data.scanned} 通 ・ 取り込み {gmail.data.runs.reduce((sum, run) => sum + run.importedCount, 0)} 件
          </span>
        ) : null}
        {gmail.error ? (
          <span role="alert" className="text-sm font-semibold text-red-700">
            {getApiErrorMessage(gmail.error, 'Gmailの確認に失敗しました')}
          </span>
        ) : null}
      </div>

      <h3 className="mt-5 text-sm font-bold text-slate-900">取り込み履歴</h3>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-slate-600">
          <tr>
            <th className="py-1 pr-3">日時</th>
            <th className="py-1 pr-3">経路</th>
            <th className="py-1 pr-3">結果</th>
            <th className="py-1 pr-3">取り込み</th>
            <th className="py-1">失敗</th>
          </tr>
        </thead>
        <tbody>
          {(runs.data ?? []).map((run) => (
            <tr key={run.id} className="border-t border-slate-200">
              <td className="py-1 pr-3 font-mono">{new Date(run.startedAt).toLocaleString('ja-JP')}</td>
              <td className="py-1 pr-3">{run.source === 'GMAIL' ? 'Gmail' : 'アップロード'}</td>
              <td className="py-1 pr-3">{run.status === 'SUCCESS' ? '成功' : run.status === 'PARTIAL' ? '一部失敗' : '失敗'}</td>
              <td className="py-1 pr-3 font-mono">{run.importedCount}</td>
              <td className="py-1 font-mono" title={run.failures.map((failure) => `${failure.fileName}: ${failure.reason}`).join('\n')}>
                {run.failedCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.data && runs.data.length === 0 ? <p className="mt-1 text-sm text-slate-600">まだ取り込んでいません。</p> : null}
    </Card>
  );
}

/** 管理画面「設備稼働」。センサーごとの設定、判定のしきい値、日報の取り込み。 */
export function MachineSignalAdminPage() {
  const sensors = useMachineSignalSensors();
  const [editing, setEditing] = useState<number | null>(null);
  const list = sensors.data ?? [];
  const sites = [...new Set(list.map((sensor) => sensor.site).filter((site): site is string => !!site))].sort();
  const editingSensor = list.find((sensor) => sensor.signalNo === editing);

  return (
    <div className="space-y-6">
      <ImportCard />

      {editingSensor ? <SensorEditor key={editingSensor.signalNo} sensor={editingSensor} sites={sites} onClose={() => setEditing(null)} /> : null}

      <Card title="センサー">
        {sensors.isLoading ? (
          <p className="text-sm text-slate-700">読み込み中…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-slate-700">日報を取り込むと、センサーがここに並びます。</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-1 pr-3">Signal</th>
                <th className="py-1 pr-3">センサー側の機械名</th>
                <th className="py-1 pr-3">表示名</th>
                <th className="py-1 pr-3">工場</th>
                <th className="py-1 pr-3">種別</th>
                <th className="py-1 pr-3">稼働予定</th>
                <th className="py-1 pr-3">電力（kW）</th>
                <th className="py-1 pr-3">最新の日報</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {list.map((sensor) => (
                <tr key={sensor.signalNo} className={sensor.hidden ? 'border-t border-slate-200 text-slate-400' : 'border-t border-slate-200'}>
                  <td className="py-1 pr-3 font-mono">{sensor.signalNo}</td>
                  <td className="py-1 pr-3">{sensor.sourceMachineName}</td>
                  <td className="py-1 pr-3">{sensor.displayName ?? '－'}</td>
                  <td className="py-1 pr-3">{sensor.site ?? '－'}</td>
                  <td className="py-1 pr-3">{KIND_LABELS[sensor.kind]}</td>
                  <td className="py-1 pr-3 font-mono">
                    {sensor.plannedStartMinute !== null && sensor.plannedEndMinute !== null
                      ? `${minuteToTimeText(sensor.plannedStartMinute)}–${minuteToTimeText(sensor.plannedEndMinute)}`
                      : '終日'}
                  </td>
                  <td className="py-1 pr-3 font-mono">
                    {sensor.runningKw === null && sensor.idleKw === null ? '－' : `${sensor.runningKw ?? '－'} / ${sensor.idleKw ?? '－'}`}
                  </td>
                  <td className="py-1 pr-3 font-mono">{sensor.latestReportDate ?? '－'}</td>
                  <td className="py-1 text-right">
                    <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEditing(sensor.signalNo)}>
                      編集
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <SettingsCard />
    </div>
  );
}
