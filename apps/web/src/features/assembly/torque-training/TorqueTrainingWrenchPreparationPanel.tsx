import { Button } from '../../../components/ui/Button';

import {
  formatTorqueTrainingBoltLength,
  formatTorqueTrainingValue,
  type TorqueTrainingWrenchPreparationTarget
} from './torqueTrainingWrenchPreparation';

export type TorqueTrainingWrenchPreparationPanelProps = {
  target: TorqueTrainingWrenchPreparationTarget;
  wrenchSerialNumber: string | null;
  disabledReason?: string | null;
  busy: boolean;
  settingRegistered: boolean;
  connectionRetryRequired: boolean;
  onPrepareAndConnect: () => void;
};

export function TorqueTrainingWrenchPreparationPanel({
  target,
  wrenchSerialNumber,
  disabledReason,
  busy,
  settingRegistered,
  connectionRetryRequired,
  onPrepareAndConnect
}: TorqueTrainingWrenchPreparationPanelProps) {
  const hasDetectedWrench = Boolean(wrenchSerialNumber);
  const buttonDisabled = Boolean(disabledReason) || !hasDetectedWrench || busy;

  return (
    <div className="w-full max-w-lg space-y-3 rounded border border-cyan-300/30 bg-cyan-500/10 p-4" data-testid="torque-training-wrench-preparation-panel">
      <div>
        <h3 className="text-base font-bold text-cyan-50">接続前のレンチ設定</h3>
        <p className="mt-1 text-sm text-cyan-100/80">表示値をレンチ本体へ設定してから、接続を開始してください。</p>
        <p className="mt-1 text-sm text-cyan-100/80">torque-agent自動検出: {wrenchSerialNumber ?? '未特定'}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded border border-white/10 bg-slate-950/40 p-3 text-sm" data-testid="torque-training-wrench-target-values">
        <div>
          <dt className="text-white/60">製造番号</dt>
          <dd className="font-semibold">{wrenchSerialNumber ?? '未特定'}</dd>
        </div>
        <div>
          <dt className="text-white/60">呼び径</dt>
          <dd className="font-semibold">{target.nominalDiameter}</dd>
        </div>
        <div>
          <dt className="text-white/60">材質</dt>
          <dd className="font-semibold">{target.material}</dd>
        </div>
        <div>
          <dt className="text-white/60">首下長さ</dt>
          <dd className="font-semibold">{formatTorqueTrainingBoltLength(target.boltLengthMm)}</dd>
        </div>
        <div>
          <dt className="text-white/60">下限</dt>
          <dd className="text-lg font-bold text-cyan-50">{formatTorqueTrainingValue(target.lowerLimit, target.unit)}</dd>
        </div>
        <div>
          <dt className="text-white/60">目標</dt>
          <dd className="text-lg font-bold text-cyan-50">{formatTorqueTrainingValue(target.nominalTorque, target.unit)}</dd>
        </div>
        <div>
          <dt className="text-white/60">上限</dt>
          <dd className="text-lg font-bold text-cyan-50">{formatTorqueTrainingValue(target.upperLimit, target.unit)}</dd>
        </div>
      </dl>
      {disabledReason ? <p className="rounded border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100" role="alert">{disabledReason}</p> : null}
      {settingRegistered && connectionRetryRequired ? (
        <p className="rounded border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100" role="status" data-testid="torque-training-setting-registered">
          設定登録済みです。torque-agent接続のみ再試行してください。
        </p>
      ) : null}
      {!hasDetectedWrench && !disabledReason ? <p className="text-sm text-white/65">torque-agentが物理レンチの製造番号を検出するまでお待ちください。</p> : null}
      <Button
        type="button"
        onClick={onPrepareAndConnect}
        disabled={buttonDisabled}
        data-testid="torque-training-prepare-connect"
      >
        {busy ? '確認中...' : 'レンチ本体を表示値に設定して接続'}
      </Button>
    </div>
  );
}
