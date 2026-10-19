import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';

import type { TorqueTrainingAdminController } from './useTorqueTrainingAdminController';

const inputClassName =
  '!rounded border !border-white/20 !bg-slate-800 !text-white placeholder:!text-white/50';

type Props = {
  controller: TorqueTrainingAdminController;
};

const formatCompletedAt = (completedAt: string | null, status: string): string =>
  completedAt ? new Date(completedAt).toLocaleString() : status;

export function TorqueTrainingAdminResultsPanel({ controller }: Props) {
  const results = controller.filteredAdminResults;

  return (
    <div className="min-w-0 space-y-3">
      <label className="block w-full max-w-md space-y-1 text-sm" htmlFor="torque-training-admin-result-query">
        <span className="block text-xs font-semibold text-white/80">実績検索</span>
        <Input
          id="torque-training-admin-result-query"
          className={inputClassName}
          placeholder="氏名・社員コード・メニューで検索"
          value={controller.resultQuery}
          onChange={(event) => controller.setResultQuery(event.target.value)}
        />
      </label>

      {results.length === 0 ? (
        <p className="rounded border border-white/10 bg-slate-900/80 p-3 text-sm text-white/60">
          該当する訓練実績はありません。
        </p>
      ) : (
        <div className="space-y-3">
          {results.map((result) => (
            <article key={result.id} className="min-w-0 rounded border border-white/10 bg-slate-900/80 p-3 text-sm">
              <p className="break-words font-semibold">
                {result.employeeName}（{result.employeeCode}） / {result.programCode} v{result.programVersion}
              </p>
              <p className="mt-1 break-words text-white/70">
                {formatCompletedAt(result.completedAt, result.status)}
              </p>
              <p className="mt-2 text-white/80">
                合格率 {Math.round(result.metrics.passRate * 100)}% / 平均絶対誤差{' '}
                {result.metrics.meanAbsoluteErrorPercent.toFixed(1)}% / ばらつき{' '}
                {result.metrics.variationPercent.toFixed(1)}%
              </p>
              {result.excludedAt ? (
                <p className="mt-2 break-words text-amber-200">
                  集計対象外: {result.exclusionReason || '理由未設定'}
                </p>
              ) : (
                <div className="mt-3 flex min-w-0 flex-wrap items-end gap-2">
                  <label className="block min-w-0 w-full max-w-sm space-y-1" htmlFor={`torque-training-admin-exclusion-${result.id}`}>
                    <span className="block text-xs font-semibold text-white/80">除外理由</span>
                    <Input
                      id={`torque-training-admin-exclusion-${result.id}`}
                      className={inputClassName}
                      placeholder="除外理由"
                      value={controller.exclusionReasons[result.id] ?? ''}
                      onChange={(event) => controller.setExclusionReason(result.id, event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={controller.adminBusy || !controller.exclusionReasons[result.id]?.trim()}
                    onClick={() => void controller.excludeResult(result.id)}
                  >
                    集計対象外
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
