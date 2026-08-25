import { useState } from 'react';

import { listAssemblyMachineNameCandidates } from '../../../api/client';
import { MachineNamePickerDialog } from '../../../components/machine/MachineNamePickerDialog';
import { Button } from '../../../components/ui/Button';

import type { SignageSelfInspectionTargetMode } from './signageLayoutConfigModel';

type SelfInspectionMachineBoardFieldsProps = {
  targetMode: SignageSelfInspectionTargetMode;
  setTargetMode: (value: SignageSelfInspectionTargetMode) => void;
  machineName: string;
  setMachineName: (value: string) => void;
  deviceScopeKey: string;
  setDeviceScopeKey: (value: string) => void;
  slideIntervalStr: string;
  setSlideIntervalStr: (value: string) => void;
  partsPerPageStr: string;
  setPartsPerPageStr: (value: string) => void;
  legacyAutoMigrationNotice: boolean;
  setLegacyAutoMigrationNotice: (value: boolean) => void;
};

export function SelfInspectionMachineBoardFields({
  targetMode,
  setTargetMode,
  machineName,
  setMachineName,
  deviceScopeKey,
  setDeviceScopeKey,
  slideIntervalStr,
  setSlideIntervalStr,
  partsPerPageStr,
  setPartsPerPageStr,
  legacyAutoMigrationNotice,
  setLegacyAutoMigrationNotice,
}: SelfInspectionMachineBoardFieldsProps) {
  const [machineNamePickerOpen, setMachineNamePickerOpen] = useState(false);

  const handleTargetModeChange = (value: SignageSelfInspectionTargetMode) => {
    setTargetMode(value);
    setLegacyAutoMigrationNotice(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-semibold text-slate-700">表示対象</label>
        <select
          value={targetMode}
          onChange={(e) => handleTargetModeChange(e.target.value as SignageSelfInspectionTargetMode)}
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        >
          <option value="kiosk_active_sessions">キオスク＞自主検査に表示中のアイテムのみ</option>
          <option value="manual_machine_name">全部品を表示</option>
        </select>
      </div>

      {legacyAutoMigrationNotice && targetMode === 'kiosk_active_sessions' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          以前の自動選定設定を読み込みました。現在は、キオスクの自主検査画面に表示中のアイテムだけを対象にします。保存すると新しい設定に移行します。
        </p>
      ) : null}

      {targetMode === 'manual_machine_name' ? (
        <>
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              全部品を表示する機種（必須・数字テンキーで選択）
            </label>
            <div className="mt-1 flex items-center gap-2">
              <output
                aria-label="選択中の機種名"
                className="min-h-11 flex-1 rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              >
                {machineName || '未選択'}
              </output>
              <Button type="button" variant="secondary" onClick={() => setMachineNamePickerOpen(true)}>
                数字で選択
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-600">文字入力は使用しません。未選択では保存できません。</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              deviceScopeKey（任意・キオスク端末と同じスコープ文字列）
            </label>
            <input
              type="text"
              value={deviceScopeKey}
              onChange={(e) => setDeviceScopeKey(e.target.value)}
              placeholder="例: 端末設定のスコープキー"
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            />
            <p className="mt-1 text-xs text-slate-600">拠点別の自主検査テンプレート/資源 policy 解決に使用します。</p>
          </div>
        </>
      ) : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          キオスクの自主検査画面に現在表示中のアイテムだけを対象にします。追加の指定は不要です。
        </p>
      )}

      <div>
        <label className="block text-sm font-semibold text-slate-700">ページ表示秒（任意・既定30）</label>
        <input
          type="text"
          inputMode="numeric"
          value={slideIntervalStr}
          onChange={(e) => setSlideIntervalStr(e.target.value)}
          placeholder="30"
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700">
          1ページの部品数（任意・既定6・最大6・1920x1080 1画面分）
        </label>
        <input
          type="text"
          inputMode="numeric"
          min={1}
          max={6}
          value={partsPerPageStr}
          onChange={(e) => setPartsPerPageStr(e.target.value)}
          placeholder="6"
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        />
        <p className="mt-1 text-xs text-slate-600">API の既存設定は 12 まで読み込めます。新規保存は最大6件です。</p>
      </div>

      <MachineNamePickerDialog
        isOpen={machineNamePickerOpen}
        currentValue={machineName}
        onCancel={() => setMachineNamePickerOpen(false)}
        onConfirm={(nextMachineName) => {
          setMachineName(nextMachineName);
          setMachineNamePickerOpen(false);
        }}
        loadCandidates={listAssemblyMachineNameCandidates}
        showTextSearch={false}
        description="数字テンキーで機種名候補を絞り込み、一覧から選択してください。文字入力は使用しません。"
      />
    </div>
  );
}
