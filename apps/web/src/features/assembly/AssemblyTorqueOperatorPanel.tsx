import { Button } from '../../components/ui/Button';

import {
  assemblyTorqueRecordResultPresentation,
  newestAssemblyTorqueRecords
} from './assemblyTorquePresentation';

import type { AssemblyTorqueCurrentFeedback } from './assemblyTorquePresentation';
import type {
  AssemblyTemplateBoltDto,
  AssemblyTorqueRecordDto
} from './types';
import type { TorqueWrenchProfileApi } from '../../api/domains/torque-wrenches';

type CurrentConditionProps = {
  currentBolt: AssemblyTemplateBoltDto | null;
  areaName: string | null | undefined;
  allBoltsComplete: boolean;
};

export function AssemblyTorqueCurrentCondition({ currentBolt, areaName, allBoltsComplete }: CurrentConditionProps) {
  const heading = currentBolt ? `丸数字 ${currentBolt.markerNo}` : allBoltsComplete ? '全締付完了' : '次工程待ち';
  return (
    <section className="border-b border-white/10 pb-2" aria-label="現在の締付条件">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <strong className="shrink-0 text-lg">{heading}</strong>
        {currentBolt ? <span className="truncate text-sm text-white/65">{areaName ?? ''}</span> : null}
      </div>
      {currentBolt ? (
        <div className="mt-1 text-sm font-semibold text-white/85">
          <strong className="text-base text-white">規定 {currentBolt.nominalTorque}</strong>{' '}
          {currentBolt.unit} <span className="text-white/55">｜許容 {currentBolt.lowerLimit}–{currentBolt.upperLimit}</span>
        </div>
      ) : null}
    </section>
  );
}

type LegacyEntryProps = {
  value: string;
  source: 'manual' | 'mock';
  disabled: boolean;
  onValueChange: (value: string) => void;
  onSourceChange: (source: 'manual' | 'mock') => void;
  onRecord: () => void;
};

export function AssemblyLegacyTorqueEntry({
  value,
  source,
  disabled,
  onValueChange,
  onSourceChange,
  onRecord
}: LegacyEntryProps) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-b border-white/10 py-2" aria-label="手入力トルク">
      <input
        aria-label="トルク値"
        className="min-w-0 rounded bg-slate-950 px-3 text-lg font-bold"
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="トルク値"
        inputMode="decimal"
      />
      <select
        aria-label="入力方式"
        className="min-h-11 rounded bg-slate-950 px-2 text-sm"
        value={source}
        disabled={disabled}
        onChange={(event) => onSourceChange(event.target.value as 'manual' | 'mock')}
      >
        <option value="manual">手入力</option>
        <option value="mock">mock</option>
      </select>
      <Button type="button" variant="primary" disabled={disabled} className="min-h-11 w-fit !px-3" onClick={onRecord}>
        記録
      </Button>
    </section>
  );
}

type RequiredEntryProps = {
  busy: boolean;
  agentConnected: boolean;
  compatibleWrenches: Array<{ profile: TorqueWrenchProfileApi; conditionFingerprint: string }>;
  selectedProfileId: string;
  confirmation: { id: string; torqueWrenchProfileId: string; settingHistoryId: string } | null;
  confirmationReused: boolean;
  onProfileChange: (profileId: string) => void;
  onConfirm: () => void;
};

export function AssemblyRequiredTorqueEntry({
  busy,
  agentConnected,
  compatibleWrenches,
  selectedProfileId,
  confirmation,
  confirmationReused,
  onProfileChange,
  onConfirm
}: RequiredEntryProps) {
  const readiness = confirmation
    ? confirmationReused
      ? '同じ締付条件の確認を引継ぎ・入力待機中'
      : '現物確認済み・入力待機中'
    : '現物確認後に入力を受け付けます';

  return (
    <section className="grid gap-2 border-b border-cyan-300/20 py-2" aria-label="トルクエージェント入力">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">トルクエージェント</span>
        <span className={agentConnected ? 'text-emerald-300' : 'text-amber-200'}>{agentConnected ? '接続済み' : '未接続'}</span>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-white/70">
        使用する物理トルクレンチ
        <select
          className="min-h-11 rounded bg-slate-950 px-2 text-sm"
          value={selectedProfileId}
          disabled={busy || Boolean(confirmation)}
          onChange={(event) => onProfileChange(event.target.value)}
        >
          {compatibleWrenches.length === 0 ? <option value="">適合レンチなし</option> : null}
          {compatibleWrenches.map(({ profile }) => {
            const setting = profile.settingHistories[0];
            return (
              <option key={profile.id} value={profile.id}>
                {profile.serialNumber} / {profile.model.modelNumber}{setting ? ` / ${setting.nominalTorque} ${setting.unit}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <Button
        type="button"
        variant="primary"
        disabled={busy || !selectedProfileId || Boolean(confirmation)}
        className="min-h-11 w-fit !px-3"
        onClick={onConfirm}
      >
        {confirmation ? '現物確認済み' : '製造番号と現物設定を確認'}
      </Button>
      <p className="rounded bg-slate-950/70 px-2 py-2 text-sm font-semibold text-white/85">{readiness}</p>
    </section>
  );
}

export function AssemblyTorqueFeedback({ feedback }: { feedback: AssemblyTorqueCurrentFeedback | null }) {
  if (!feedback) return null;
  return (
    <p
      className={
        feedback.kind === 'ng'
          ? 'mt-2 rounded bg-rose-500/15 px-2 py-2 text-sm font-bold text-rose-100'
          : 'mt-2 rounded bg-amber-500/15 px-2 py-2 text-sm font-bold text-amber-100'
      }
    >
      {feedback.message}
    </p>
  );
}

type WorkflowProps = {
  busy: boolean;
  advanceDisabled: boolean;
  restartDisabled: boolean;
  completeDisabled: boolean;
  completeDisabledReason: string | null;
  onAdvance: () => void;
  onRestart: () => void;
  onComplete: () => void;
};

export function AssemblyTorqueWorkflowActions({
  busy,
  advanceDisabled,
  restartDisabled,
  completeDisabled,
  completeDisabledReason,
  onAdvance,
  onRestart,
  onComplete
}: WorkflowProps) {
  return (
    <>
      <section className="flex flex-wrap gap-2 border-b border-white/10 py-2" aria-label="工程操作">
        <Button type="button" variant="secondary" disabled={busy || advanceDisabled} className="min-h-11 w-fit !px-3" onClick={onAdvance}>
          次工程へ
        </Button>
        <Button type="button" variant="danger" disabled={busy || restartDisabled} className="min-h-11 w-fit !px-3" onClick={onRestart}>
          やり直し
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={busy || completeDisabled}
          className="min-h-11 w-fit !px-3"
          title={completeDisabledReason ?? undefined}
          onClick={onComplete}
        >
          作業完了
        </Button>
      </section>
      {completeDisabledReason ? <p className="mt-2 text-sm font-semibold text-amber-200">{completeDisabledReason}</p> : null}
    </>
  );
}

function recordTime(record: AssemblyTorqueRecordDto): string {
  const date = new Date(record.recordedAt);
  if (Number.isNaN(date.getTime())) return '時刻不明';
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AssemblyTorqueHistory({ records }: { records: AssemblyTorqueRecordDto[] }) {
  return (
    <section className="pt-3" aria-label="トルク入力履歴">
      <h3 className="text-sm font-bold">履歴</h3>
      <div className="mt-2 max-h-[13rem] overflow-y-auto rounded border border-white/10">
        {newestAssemblyTorqueRecords(records).map((record) => {
          const result = assemblyTorqueRecordResultPresentation(record);
          return (
            <div key={record.id} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-bold">丸数字 {record.markerNo}</div>
                <div className="truncate text-sm text-white/55">
                  {recordTime(record)}{record.serialNumberSnapshot ? ` / ${record.serialNumberSnapshot}` : ''}
                </div>
              </div>
              <div className="grid justify-items-end gap-1">
                <strong className="text-base tabular-nums">{record.value ?? '—'}{record.inputUnit ? ` ${record.inputUnit}` : ''}</strong>
                <span
                  className={
                    result.tone === 'ok'
                      ? 'rounded-full bg-emerald-500/20 px-2 py-0.5 text-sm font-bold text-emerald-200'
                      : result.tone === 'ng'
                        ? 'rounded-full bg-rose-500/20 px-2 py-0.5 text-sm font-bold text-rose-100'
                        : 'rounded-full bg-amber-500/20 px-2 py-0.5 text-sm font-bold text-amber-100'
                  }
                >
                  {result.label}
                </span>
              </div>
            </div>
          );
        })}
        {records.length === 0 ? <p className="px-3 py-3 text-sm text-white/55">入力履歴はありません。</p> : null}
      </div>
    </section>
  );
}
