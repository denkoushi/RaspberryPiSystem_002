import type { CsvDashboardEditor } from './useCsvDashboardEditor';
import type { CsvDashboard } from '../../../api/client';

type CsvDashboardBasicSettingsFieldsProps = {
  editor: CsvDashboardEditor;
  selected: CsvDashboard;
};

export function CsvDashboardBasicSettingsFields({ editor, selected }: CsvDashboardBasicSettingsFieldsProps) {
  const {
    displayPeriodDays,
    setDisplayPeriodDays,
    dateColumnName,
    setDateColumnName,
    emptyMessage,
    setEmptyMessage,
    gmailSubjectPattern,
    setGmailSubjectPattern,
    enabled,
    setEnabled,
  } = editor;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold text-slate-700">表示期間（日数）</label>
          <input
            type="number"
            min={1}
            value={displayPeriodDays}
            onChange={(e) => setDisplayPeriodDays(Number(e.target.value))}
            className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          />
          <p className="mt-1 text-xs text-slate-500">当日分のみ = 1 / 直近7日 = 7</p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700">日付列名（internalName）</label>
          <input
            value={dateColumnName}
            onChange={(e) => setDateColumnName(e.target.value)}
            className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            placeholder={selected.dateColumnName ?? '例: date'}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700">ゼロ件時メッセージ</label>
        <input
          value={emptyMessage}
          onChange={(e) => setEmptyMessage(e.target.value)}
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          placeholder="例: 本日のデータはありません"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700">Gmail件名パターン</label>
        <input
          value={gmailSubjectPattern}
          onChange={(e) => setGmailSubjectPattern(e.target.value)}
          className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          placeholder="例: 生産日程_三島_研削工程"
        />
        <p className="mt-1 text-xs text-slate-500">
          GmailからCSVを取得する際の件名パターン。スケジュール実行時に使用されます。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="csv-dashboard-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="csv-dashboard-enabled" className="text-sm font-semibold text-slate-700">
          有効
        </label>
      </div>
    </>
  );
}
