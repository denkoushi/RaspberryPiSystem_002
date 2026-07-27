import clsx from 'clsx';

import { Button } from '../../components/ui/Button';

import type {
  AssemblyTemplateReadiness,
  AssemblyTemplateReadinessIssue,
  AssemblyTemplateReadinessStage
} from './assemblyTemplateReadiness';

const STAGES: Array<{
  id: AssemblyTemplateReadinessStage;
  step: number;
  label: string;
}> = [
  { id: 'basic', step: 1, label: '基本設定' },
  { id: 'procedure', step: 2, label: '文書と表示手順' },
  { id: 'areas', step: 3, label: '工程と締付点' },
  { id: 'review', step: 4, label: '確認して保存' }
];

type Props = {
  readiness: AssemblyTemplateReadiness;
  expanded: boolean;
  readOnly: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onStageClick: (stage: AssemblyTemplateReadinessStage) => void;
  onIssueClick: (issue: AssemblyTemplateReadinessIssue) => void;
  onRetryCapabilityCatalog: () => void;
};

function statusLabel(status: AssemblyTemplateReadiness['stages'][AssemblyTemplateReadinessStage]) {
  if (status === 'complete') return '完了';
  if (status === 'checking') return '確認中';
  return '未完了';
}
export function AssemblyTemplateCreationGuide({
  readiness,
  expanded,
  readOnly,
  onExpandedChange,
  onStageClick,
  onIssueClick,
  onRetryCapabilityCatalog
}: Props) {
  const catalogUnavailable = readiness.issues.some(
    (issue) => issue.code === 'capability_catalog.unavailable'
  );

  return (
    <section
      className="shrink-0 rounded border border-cyan-300/25 bg-slate-900/85 p-2"
      aria-label="テンプレート作成ガイド"
      data-testid="assembly-template-creation-guide"
    >
      <div className="flex flex-wrap items-stretch gap-1.5">
        {STAGES.map((stage) => {
          const status = readiness.stages[stage.id];
          return (
            <button
              key={stage.id}
              type="button"
              className={clsx(
                'flex min-h-11 min-w-[10.5rem] flex-1 items-center gap-2 rounded border px-2 text-left',
                status === 'complete'
                  ? 'border-emerald-300/35 bg-emerald-950/35'
                  : status === 'checking'
                    ? 'border-sky-300/35 bg-sky-950/35'
                    : 'border-amber-300/35 bg-amber-950/35'
              )}
              onClick={() => onStageClick(stage.id)}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-black">
                {stage.step}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold">{stage.label}</span>
                <span
                  className={clsx(
                    'block text-[0.68rem] font-semibold',
                    status === 'complete'
                      ? 'text-emerald-200'
                      : status === 'checking'
                        ? 'text-sky-200'
                        : 'text-amber-200'
                  )}
                >
                  {statusLabel(status)}
                </span>
              </span>
            </button>
          );
        })}
        {!readOnly ? (
          <Button
            type="button"
            variant={readiness.isReady ? 'secondary' : 'ghostOnDark'}
            className="min-h-11 shrink-0"
            aria-expanded={expanded}
            onClick={() => onExpandedChange(!expanded)}
          >
            {readiness.isReady ? '保存できます' : `未完了 ${readiness.issues.length}件`}
          </Button>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {readiness.isReady
          ? '保存条件をすべて満たしました。'
          : `未完了項目が${readiness.issues.length}件あります。`}
      </p>

      {expanded && !readOnly ? (
        <div className="mt-2 max-h-52 overflow-y-auto rounded border border-white/10 bg-slate-950/70 p-2">
          {readiness.issues.length === 0 ? (
            <p className="text-sm font-semibold text-emerald-200">
              保存条件をすべて満たしました。
            </p>
          ) : (
            <ol className="grid gap-1">
              {readiness.issues.map((issue, index) => (
                <li key={`${issue.code}:${issue.target.id ?? ''}:${index}`}>
                  <button
                    type="button"
                    className="min-h-10 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-left text-xs font-semibold text-amber-100 hover:bg-white/10"
                    onClick={() => onIssueClick(issue)}
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {catalogUnavailable ? (
            <Button
              type="button"
              variant="ghostOnDark"
              className="mt-2 min-h-10"
              onClick={onRetryCapabilityCatalog}
            >
              適合グループを再読込
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
