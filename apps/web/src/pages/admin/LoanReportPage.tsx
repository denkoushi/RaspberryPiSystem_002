import { useMemo, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { LoanReportFilters, type LoanReportFilterValues } from '../../features/admin/loan-report/LoanReportFilters';
import { LoanReportPreviewFrame } from '../../features/admin/loan-report/LoanReportPreviewFrame';
import { useLoanReportDraftMutation } from '../../features/admin/loan-report/useLoanReportDraftMutation';
import { useLoanReportPreview } from '../../features/admin/loan-report/useLoanReportPreview';

function todayISODate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgoISODate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function LoanReportPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<LoanReportFilterValues>({
    category: 'measuring',
    periodFrom: daysAgoISODate(30),
    periodTo: todayISODate(),
    monthlyMonths: 6,
    site: '',
    subject: '【貸出レポート】',
    to: '',
  });

  const [previewEnabled, setPreviewEnabled] = useState(false);

  const previewParams = useMemo(
    () => ({
      category: filters.category,
      periodFrom: filters.periodFrom,
      periodTo: filters.periodTo,
      monthlyMonths: filters.monthlyMonths,
      timeZone: 'Asia/Tokyo',
      site: filters.site || undefined,
      author: user?.username,
    }),
    [filters.category, filters.periodFrom, filters.periodTo, filters.monthlyMonths, filters.site, user?.username]
  );

  const preview = useLoanReportPreview(previewParams, previewEnabled);
  const draftMutation = useLoanReportDraftMutation();

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4 px-4 py-6 text-white">
      <div>
        <h2 className="text-2xl font-bold">貸出レポート</h2>
        <p className="mt-1 text-sm text-white/70">
          カテゴリ別に A4 1枚の HTML レポートを API が生成します。Gmail は下書き作成のみ（送信しません）。
        </p>
      </div>

      <LoanReportFilters
        value={filters}
        onChange={setFilters}
        previewLoading={preview.isFetching}
        onPreview={() => setPreviewEnabled(true)}
      />

      {preview.isError ? (
        <div className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
          プレビュー生成に失敗しました: {(preview.error as Error)?.message ?? String(preview.error)}
        </div>
      ) : null}

      {draftMutation.isError ? (
        <div className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
          下書き作成に失敗しました: {(draftMutation.error as Error)?.message ?? String(draftMutation.error)}
        </div>
      ) : null}

      {draftMutation.isSuccess ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
          Gmail 下書きを作成しました（draftId: {draftMutation.data.draftId}
          {draftMutation.data.messageId ? ` / messageId: ${draftMutation.data.messageId}` : ''}）。
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!preview.isSuccess || draftMutation.isPending}
          onClick={() =>
            draftMutation.mutate({
              ...previewParams,
              subject: filters.subject,
              to: filters.to || undefined,
            })
          }
        >
          {draftMutation.isPending ? '下書き作成中…' : 'Gmail 下書き作成'}
        </Button>
        <p className="text-xs text-white/60">
          ADMIN / MANAGER のみ実行できます。Gmail 設定（storage.provider=gmail）と権限スコープが必要です。
        </p>
      </div>

      <LoanReportPreviewFrame html={preview.data?.html} />
    </div>
  );
}
