import type { LoanReportCategoryKey } from '../../../api/backup';

export type LoanReportFilterValues = {
  category: LoanReportCategoryKey;
  periodFrom: string;
  periodTo: string;
  monthlyMonths: number;
  site: string;
  subject: string;
  to: string;
};

function clampMonthlyMonths(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(24, Math.max(1, Math.trunc(value)));
}

export function LoanReportFilters(props: {
  value: LoanReportFilterValues;
  onChange: (next: LoanReportFilterValues) => void;
  onPreview: () => void;
  previewLoading: boolean;
  variant?: 'default' | 'sidebar';
}) {
  const { value, onChange, onPreview, previewLoading, variant = 'default' } = props;
  const gridClass =
    variant === 'sidebar' ? 'grid grid-cols-1 gap-3' : 'grid gap-3 md:grid-cols-2 lg:grid-cols-3';
  const wideFieldClass =
    variant === 'sidebar' ? 'grid gap-1 text-sm' : 'grid gap-1 text-sm md:col-span-2';

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/40 p-4 text-white">
      <div className={gridClass}>
        <label className="grid gap-1 text-sm">
          <span className="text-white/70">カテゴリ</span>
          <select
            className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value as LoanReportCategoryKey })}
          >
            <option value="measuring">計測機器</option>
            <option value="rigging">吊具</option>
            <option value="tools">道具（写真持出集計）</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-white/70">期間 From</span>
          <input
            type="date"
            className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={value.periodFrom}
            onChange={(e) => onChange({ ...value, periodFrom: e.target.value })}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-white/70">期間 To</span>
          <input
            type="date"
            className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={value.periodTo}
            onChange={(e) => onChange({ ...value, periodTo: e.target.value })}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-white/70">月次系列の本数（1-24）</span>
          <input
            type="number"
            min={1}
            max={24}
            step={1}
            className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={value.monthlyMonths}
            onChange={(e) =>
              onChange({
                ...value,
                monthlyMonths: clampMonthlyMonths(e.target.valueAsNumber),
              })
            }
          />
        </label>

        <label className={wideFieldClass}>
          <span className="text-white/70">拠点（レポート表記）</span>
          <input
            className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={value.site}
            onChange={(e) => onChange({ ...value, site: e.target.value })}
            placeholder="例: 本社工場"
          />
        </label>

        <label className={wideFieldClass}>
          <span className="text-white/70">メール件名（下書き・送信共通）</span>
          <input
            className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={value.subject}
            onChange={(e) => onChange({ ...value, subject: e.target.value })}
            placeholder="例: 【貸出レポート】計測機器（2026-04）"
          />
        </label>

        <label className={wideFieldClass}>
          <span className="text-white/70">宛先 To（下書きは任意・Gmail 送信は必須）</span>
          <input
            className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            placeholder="例: team@example.com（下書きのみなら空でも可）"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          onClick={onPreview}
          disabled={previewLoading}
        >
          {previewLoading ? '生成中…' : 'プレビュー生成'}
        </button>
        <p className="text-xs text-white/60">
          プレビュー/添付の HTML は API が生成したものをそのまま表示します（正本は API）。
        </p>
      </div>
    </div>
  );
}
