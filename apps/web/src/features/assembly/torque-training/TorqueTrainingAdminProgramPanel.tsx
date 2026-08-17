import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';

import type { TorqueTrainingAdminController } from './useTorqueTrainingAdminController';

type ProgramFormField =
  | 'code'
  | 'displayName'
  | 'nominalDiameter'
  | 'boltLengthMm'
  | 'material'
  | 'strengthClass'
  | 'nominalTorque'
  | 'lowerLimit'
  | 'upperLimit'
  | 'unit'
  | 'jigConditionCode';

const PROGRAM_FORM_FIELDS: Array<{
  key: ProgramFormField;
  label: string;
  inputMode?: 'decimal' | 'text';
}> = [
  { key: 'code', label: 'メニューコード' },
  { key: 'displayName', label: '表示名' },
  { key: 'nominalDiameter', label: '呼び径' },
  { key: 'boltLengthMm', label: 'ボルト長さ（mm）', inputMode: 'decimal' },
  { key: 'material', label: '材質' },
  { key: 'strengthClass', label: '強度区分' },
  { key: 'nominalTorque', label: '目標トルク', inputMode: 'decimal' },
  { key: 'lowerLimit', label: '下限値', inputMode: 'decimal' },
  { key: 'upperLimit', label: '上限値', inputMode: 'decimal' },
  { key: 'unit', label: '単位' },
  { key: 'jigConditionCode', label: '治具条件コード' }
];

const inputClassName =
  '!rounded border !border-white/20 !bg-slate-800 !text-white placeholder:!text-white/50';
const selectClassName =
  'min-h-10 w-full min-w-0 rounded border border-white/20 bg-slate-800 px-2 text-white focus:border-emerald-400 focus:outline-none';

type Props = {
  controller: TorqueTrainingAdminController;
};

export function TorqueTrainingAdminProgramPanel({ controller }: Props) {
  const { programForm } = controller;

  const requestDeactivation = (programId: string) => {
    const reason = window.prompt('停止理由を入力してください。');
    if (reason == null) return;
    void controller.deactivate(programId, reason);
  };

  return (
    <div className="space-y-4">
      <section className="min-w-0 space-y-3 rounded border border-white/10 bg-slate-900/80 p-3">
        <div>
          <h3 className="font-semibold text-white">メニュー追加・新版作成</h3>
          <p className="mt-1 text-xs text-white/60">
            入力欄は設定パネル内で折り返し、横長画面でも必要な幅に収めます。
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {PROGRAM_FORM_FIELDS.map(({ key, label, inputMode }) => (
            <label key={key} className="min-w-0 space-y-1 text-sm" htmlFor={`torque-training-admin-${key}`}>
              <span className="block text-xs font-semibold text-white/80">{label}</span>
              <Input
                id={`torque-training-admin-${key}`}
                className={inputClassName}
                inputMode={inputMode}
                placeholder={key}
                value={programForm[key]}
                onChange={(event) => controller.updateProgramForm(key, event.target.value)}
              />
            </label>
          ))}

          <label
            className="min-w-0 space-y-1 text-sm sm:col-span-2"
            htmlFor="torque-training-admin-capability-group"
          >
            <span className="block text-xs font-semibold text-white/80">レンチ能力グループ</span>
            <select
              id="torque-training-admin-capability-group"
              className={selectClassName}
              value={programForm.capabilityGroupId}
              onChange={(event) => controller.updateProgramForm('capabilityGroupId', event.target.value)}
            >
              <option value="">能力グループを選択</option>
              {controller.capabilityGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}（{group.nominalDiameter}）
                </option>
              ))}
            </select>
          </label>

          <label
            className="min-w-0 space-y-1 text-sm sm:col-span-2"
            htmlFor="torque-training-admin-wrench-profiles"
          >
            <span className="block text-xs font-semibold text-white/80">使用可能なレンチ</span>
            <select
              id="torque-training-admin-wrench-profiles"
              multiple
              className={`${selectClassName} min-h-20`}
              value={programForm.torqueWrenchProfileIds}
              onChange={(event) =>
                controller.updateProgramForm(
                  'torqueWrenchProfileIds',
                  Array.from(event.target.selectedOptions, (option) => option.value)
                )
              }
            >
              {controller.wrenchProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.serialNumber}
                </option>
              ))}
            </select>
            <span className="block text-xs text-white/55">複数選択する場合は Ctrl / ⌘ を押しながら選択してください。</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={controller.adminBusy}
            onClick={() => void controller.submitProgram(false)}
          >
            メニューを追加
          </Button>
          <label className="min-w-0" htmlFor="torque-training-admin-revision-program">
            <span className="sr-only">新版対象</span>
            <select
              id="torque-training-admin-revision-program"
              className={`${selectClassName} w-full max-w-xs`}
              value={controller.revisionProgramId}
              onChange={(event) => controller.setRevisionProgramId(event.target.value)}
            >
              <option value="">新版対象を選択</option>
              {controller.adminPrograms
                .filter((program) => program.isActive)
                .map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.code}
                  </option>
                ))}
            </select>
          </label>
          <Button
            type="button"
            disabled={controller.adminBusy || !controller.revisionProgramId}
            onClick={() => void controller.submitProgram(true)}
          >
            新版を追加
          </Button>
        </div>
      </section>

      <section className="min-w-0 space-y-2 rounded border border-white/10 bg-slate-900/80 p-3">
        <div>
          <h3 className="font-semibold text-white">利用停止</h3>
          <p className="mt-1 text-xs text-white/60">停止理由は操作時に確認します。</p>
        </div>
        {controller.adminPrograms.length === 0 ? (
          <p className="text-sm text-white/60">登録済みの訓練メニューはありません。</p>
        ) : (
          <div className="space-y-2">
            {controller.adminPrograms.map((program) => (
              <div
                key={program.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-slate-800/70 p-2 text-sm"
              >
                <span className="min-w-0 truncate" title={`${program.code} / v${program.currentVersion}`}>
                  {program.code} / v{program.currentVersion}（{program.isActive ? '利用中' : '停止'}）
                </span>
                {program.isActive ? (
                  <Button
                    type="button"
                    className="shrink-0 px-3 py-1.5 text-sm"
                    variant="danger"
                    disabled={controller.adminBusy}
                    onClick={() => requestDeactivation(program.id)}
                  >
                    停止
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
