import { kioskFlowButtonClass } from '../kiosk/kioskFlowButtonTheme';

import type { AssemblyTemplateBoltDto } from './types';


type Props = {
  bolt: AssemblyTemplateBoltDto | null;
  programLabel: string;
  serialNumber: string | null;
  busy: boolean;
  ready: boolean;
  retryRequired: boolean;
  disabled: boolean;
  onConnect: () => void;
};

export function AssemblyBoltConditionPreparationCard({
  bolt,
  programLabel,
  serialNumber,
  busy,
  ready,
  retryRequired,
  disabled,
  onConnect
}: Props) {
  return (
    <>
      <div className="col-span-2 rounded border border-amber-300/25 bg-amber-500/10 p-3 text-sm" data-testid="assembly-bolt-condition-target">
        <p className="font-semibold text-amber-100">設定照合対象外</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-white/85">
          <div><dt className="text-white/55">製造番号</dt><dd className="font-semibold">{serialNumber ?? '未選択'}</dd></div>
          <div><dt className="text-white/55">対象プログラム</dt><dd className="font-semibold">{programLabel}</dd></div>
          <div><dt className="text-white/55">対象ボルト</dt><dd className="font-semibold">{bolt?.boltSpec ?? '未指定'}</dd></div>
          <div><dt className="text-white/55">下限</dt><dd className="font-semibold">{bolt?.lowerLimit ?? '-'} {bolt?.unit ?? ''}</dd></div>
          <div><dt className="text-white/55">規定</dt><dd className="font-semibold">{bolt?.nominalTorque ?? '-'} {bolt?.unit ?? ''}</dd></div>
          <div><dt className="text-white/55">上限</dt><dd className="font-semibold">{bolt?.upperLimit ?? '-'} {bolt?.unit ?? ''}</dd></div>
        </dl>
      </div>
      <button
        type="button"
        className={`${kioskFlowButtonClass({ disabled, highlighted: !disabled })} col-span-2`}
        disabled={disabled}
        onClick={onConnect}
        data-testid="assembly-bolt-connect"
      >
        {busy ? '確認中...' : 'レンチ本体を表示値に設定して接続'}
      </button>
      <div className="col-span-2 rounded bg-slate-950/70 px-3 py-2 text-center text-sm font-semibold">
        {!serialNumber
          ? 'torque-agentが物理レンチを検出するまでお待ちください'
          : retryRequired
            ? '確認済み・接続を再試行'
            : ready
              ? '入力待機中'
              : 'ボルト条件を確認して接続してください'}
      </div>
    </>
  );
}
