import { parseResourceCdListInput } from './signageScheduleDisplay';

import type { SignageSelfInspectionTargetMode } from './signageLayoutConfigModel';

type SelfInspectionMachineBoardFieldsProps = {
  targetMode: SignageSelfInspectionTargetMode;
  setTargetMode: (value: SignageSelfInspectionTargetMode) => void;
  machineName: string;
  setMachineName: (value: string) => void;
  deviceScopeKey: string;
  setDeviceScopeKey: (value: string) => void;
  resourceCdsText: string;
  setResourceCdsText: (value: string) => void;
  maxAutoMachinesStr: string;
  setMaxAutoMachinesStr: (value: string) => void;
  slideIntervalStr: string;
  setSlideIntervalStr: (value: string) => void;
  partsPerPageStr: string;
  setPartsPerPageStr: (value: string) => void;
};

export function SelfInspectionMachineBoardFields({
  targetMode,
  setTargetMode,
  machineName,
  setMachineName,
  deviceScopeKey,
  setDeviceScopeKey,
  resourceCdsText,
  setResourceCdsText,
  maxAutoMachinesStr,
  setMaxAutoMachinesStr,
  slideIntervalStr,
  setSlideIntervalStr,
  partsPerPageStr,
  setPartsPerPageStr,
}: SelfInspectionMachineBoardFieldsProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-semibold text-slate-700">対象選定モード targetMode</label>
        <select
          value={targetMode}
          onChange={(e) => setTargetMode(e.target.value as SignageSelfInspectionTargetMode)}
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        >
          <option value="manual_machine_name">機種名を手入力</option>
          <option value="auto_from_leaderboard_status">順位ボードの入力中機種を自動選定</option>
        </select>
      </div>

      {targetMode === 'manual_machine_name' ? (
        <div>
          <label className="block text-sm font-semibold text-slate-700">
            機種名 machineName（必須・生産日程と正規化比較）
          </label>
          <input
            type="text"
            value={machineName}
            onChange={(e) => setMachineName(e.target.value)}
            placeholder="例: L300KP"
            className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          />
          <p className="mt-1 text-xs text-slate-600">未入力では保存できません（必須）。</p>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              resourceCds（必須・順位ボードと同じ資源CD）
            </label>
            <textarea
              value={resourceCdsText}
              onChange={(e) => setResourceCdsText(e.target.value)}
              placeholder={'例:\nRD01\nRD02'}
              rows={4}
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-900"
            />
            <p className="mt-1 text-xs text-slate-600">
              現在の入力: {parseResourceCdListInput(resourceCdsText).length} 件。黄（入力中）を持つ機種だけを自動表示します。
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              自動選定機種数上限 maxAutoMachines（任意・既定5・最大20）
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={maxAutoMachinesStr}
              onChange={(e) => setMaxAutoMachinesStr(e.target.value)}
              placeholder="5"
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-semibold text-slate-700">
          deviceScopeKey（キオスク端末と同じスコープ文字列・{targetMode === 'auto_from_leaderboard_status' ? '必須' : '推奨'}）
        </label>
        <input
          type="text"
          value={deviceScopeKey}
          onChange={(e) => setDeviceScopeKey(e.target.value)}
          placeholder="例: 端末設定のスコープキー"
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        />
        <p className="mt-1 text-xs text-slate-600">
          {targetMode === 'auto_from_leaderboard_status'
            ? '自動選定の母集団（拠点・資源 policy）解決に必須です。'
            : '拠点別の自主検査テンプレート/資源 policy 解決に使用します。未設定時はグローバル fallback です。'}
        </p>
      </div>

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
        <p className="mt-1 text-xs text-slate-600">
          API の既存設定は 12 まで読み込めます。新規保存は最大6件です。
        </p>
      </div>
    </div>
  );
}
