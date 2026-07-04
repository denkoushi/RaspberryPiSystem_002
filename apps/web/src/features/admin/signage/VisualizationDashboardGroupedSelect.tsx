import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { formatVisualizationOptionLabel, groupVisualizationDashboardsForSignage } from './signageScheduleDisplay';

import type { VisualizationDashboard } from '../../../api/client';

export function VisualizationDashboardGroupedSelect({
  id,
  value,
  onChange,
  dashboards,
  isListPending,
  isListError,
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  dashboards: VisualizationDashboard[] | undefined;
  /** 一覧取得中は「未登録」案内を出さない（誤表示防止） */
  isListPending: boolean;
  isListError: boolean;
}) {
  const { pallet, rigging, other } = useMemo(() => groupVisualizationDashboardsForSignage(dashboards), [dashboards]);
  const palletMissing =
    !isListPending && !isListError && pallet.length === 0;

  return (
    <div className="space-y-2">
      {palletMissing ? (
        <div
          className="rounded-md border-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-950"
          role="status"
        >
          <strong className="font-semibold">パレット可視化</strong>が一覧にありません。先に{' '}
          <Link to="/admin/visualization-dashboards" className="font-semibold text-amber-900 underline hover:text-amber-950">
            可視化ダッシュボード
          </Link>
          を開き、<strong className="font-semibold">パレット可視化プリセットを適用</strong>→保存してください。保存後、下のプルダウンに「
          <strong className="font-semibold">パレット可視化</strong>」グループが現れます。
        </div>
      ) : null}
      <select
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
      >
        <option value="">選択してください</option>
        {pallet.length > 0 ? (
          <optgroup label="パレット可視化">
            {pallet.map((dashboard: VisualizationDashboard) => (
              <option key={dashboard.id} value={dashboard.id}>
                {formatVisualizationOptionLabel(dashboard)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {rigging.length > 0 ? (
          <optgroup label="吊具点検">
            {rigging.map((dashboard: VisualizationDashboard) => (
              <option key={dashboard.id} value={dashboard.id}>
                {formatVisualizationOptionLabel(dashboard)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {other.length > 0 ? (
          <optgroup label="その他の可視化">
            {other.map((dashboard: VisualizationDashboard) => (
              <option key={dashboard.id} value={dashboard.id}>
                {formatVisualizationOptionLabel(dashboard)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </div>
  );
}

export function VisualizationDashboardSelectHelp() {
  return (
    <p className="mt-1 text-xs text-slate-600">
      「（無効）」のダッシュボードをサイネージで使う場合は、
      <Link to="/admin/visualization-dashboards" className="font-semibold text-sky-700 underline hover:text-sky-900">
        可視化ダッシュボード
      </Link>
      で<strong className="font-semibold text-slate-800">有効</strong>にしてください。
    </p>
  );
}
