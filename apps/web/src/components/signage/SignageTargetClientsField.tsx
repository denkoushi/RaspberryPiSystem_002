import { resolveSignageTargetClientCandidates } from '../../lib/signageTargetClientDevices';

import type { ClientDevice } from '../../api/client';

export interface SignageTargetClientsFieldProps {
  allClients: ClientDevice[];
  value: string[];
  onChange: (apiKeys: string[]) => void;
  disabled?: boolean;
}

/**
 * スケジュールの targetClientKeys 編集。空配列=全端末向け。
 */
export function SignageTargetClientsField({
  allClients,
  value,
  onChange,
  disabled = false,
}: SignageTargetClientsFieldProps) {
  const candidates = resolveSignageTargetClientCandidates(allClients, value);

  const toggle = (apiKey: string) => {
    if (disabled) return;
    if (value.includes(apiKey)) {
      onChange(value.filter((k) => k !== apiKey));
    } else {
      onChange([...value, apiKey]);
    }
  };

  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  return (
    <div className="space-y-2 rounded-md border-2 border-slate-400 bg-white/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-semibold text-slate-800">対象端末（サイネージ表示）</label>
        <button
          type="button"
          onClick={clearAll}
          disabled={disabled || value.length === 0}
          className="text-xs font-semibold text-slate-600 underline decoration-slate-500 hover:text-slate-900 disabled:opacity-40"
        >
          全端末向けに戻す
        </button>
      </div>
      <p className="text-xs font-medium text-slate-600 leading-relaxed">
        何も選ばない場合は<strong>全端末</strong>に適用されます（共通スケジュール）。端末を選ぶと、その端末にだけこのスケジュールが候補になります。
        複数スケジュールが同じ時間帯に当てはまる場合は、既存の<strong>優先度・曜日・時刻</strong>ルールで1つに決まります。
      </p>
      {candidates.length === 0 ? (
        <p className="text-sm font-semibold text-amber-800">
          サイネージ用の端末が見つかりません（apiKey に &quot;signage&quot; を含む端末を登録してください）。
        </p>
      ) : (
        <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
          {candidates.map((client) => {
            const checked = value.includes(client.apiKey);
            const label =
              client.location && client.location.trim() !== ''
                ? `${client.name}（${client.location}）`
                : client.name;
            return (
              <li key={client.id} className="flex items-start gap-2">
                <input
                  id={`signage-target-${client.id}`}
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(client.apiKey)}
                  className="mt-1 rounded border-2 border-slate-500"
                />
                <label
                  htmlFor={`signage-target-${client.id}`}
                  className="cursor-pointer text-sm font-semibold text-slate-800"
                >
                  {label}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
