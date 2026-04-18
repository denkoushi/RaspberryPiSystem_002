import { useMemo, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { LoanReportFilters, type LoanReportFilterValues } from '../../features/admin/loan-report/LoanReportFilters';
import { LoanReportPreviewFrame } from '../../features/admin/loan-report/LoanReportPreviewFrame';
import { useLoanReportDraftMutation } from '../../features/admin/loan-report/useLoanReportDraftMutation';
import { useLoanReportPreview } from '../../features/admin/loan-report/useLoanReportPreview';
import { useLoanReportSendMutation } from '../../features/admin/loan-report/useLoanReportSendMutation';

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
  const confirm = useConfirm();
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
  const sendMutation = useLoanReportSendMutation();

  const isAdmin = user?.role === 'ADMIN';
  const toTrimmed = filters.to.trim();
  const canSend = isAdmin && preview.isSuccess && toTrimmed.length > 0 && !sendMutation.isPending && !draftMutation.isPending;

  const handleSend = async () => {
    if (!canSend) return;
    const ok = await confirm({
      title: 'Gmail で貸出レポートを送信しますか？',
      description: `宛先: ${toTrimmed}\n件名: ${filters.subject}\n\n即時送信されます。取り消しは Gmail 側の操作に依存します。`,
      confirmLabel: '送信する',
      cancelLabel: 'キャンセル',
      tone: 'danger',
    });
    if (!ok) return;
    sendMutation.mutate({
      ...previewParams,
      subject: filters.subject,
      to: toTrimmed,
    });
  };

  return (
    <div className="relative left-1/2 w-screen max-w-none -translate-x-1/2 px-4 py-6 text-white lg:px-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <div className="flex w-full shrink-0 flex-col gap-4 lg:max-h-[calc(100dvh-5rem)] lg:w-[22rem] lg:overflow-y-auto xl:w-[24rem]">
          <div>
            <h2 className="text-2xl font-bold">貸出レポート</h2>
            <p className="mt-1 text-sm text-white/70">
              カテゴリ別に A4 1枚の HTML レポートを API が生成します。Gmail は下書き作成または即時送信（ADMIN
              のみ）が可能です。
            </p>
          </div>

          <LoanReportFilters
            variant="sidebar"
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

          {sendMutation.isError ? (
            <div className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
              Gmail 送信に失敗しました: {(sendMutation.error as Error)?.message ?? String(sendMutation.error)}
            </div>
          ) : null}

          {draftMutation.isSuccess ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
              Gmail 下書きを作成しました（draftId: {draftMutation.data.draftId}
              {draftMutation.data.messageId ? ` / messageId: ${draftMutation.data.messageId}` : ''}）。
            </div>
          ) : null}

          {sendMutation.isSuccess ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
              Gmail 送信が完了しました（messageId: {sendMutation.data.messageId}）。
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={!preview.isSuccess || draftMutation.isPending || sendMutation.isPending}
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
                ADMIN / MANAGER が実行可能。Gmail 設定（storage.provider=gmail）とスコープ（gmail.compose 等）が必要です。
              </p>
            </div>

            {isAdmin ? (
              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                <Button
                  variant="primary"
                  disabled={!canSend}
                  onClick={() => void handleSend()}
                  className="!bg-amber-700 hover:!bg-amber-600"
                >
                  {sendMutation.isPending ? '送信中…' : 'Gmail 即時送信'}
                </Button>
                <p className="text-xs text-white/60">
                  <strong className="text-amber-200/90">ADMIN のみ</strong>
                  。宛先 To が必須。送信前に確認ダイアログが開きます。gmail.send スコープを含む再認可が必要な場合があります。
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:min-h-[calc(100dvh-5rem)]">
          <p className="text-xs text-white/50 lg:sr-only">プレビュー（右ペインで広く表示）</p>
          <LoanReportPreviewFrame html={preview.data?.html} className="min-h-[60vh] lg:min-h-0" />
        </div>
      </div>
    </div>
  );
}
