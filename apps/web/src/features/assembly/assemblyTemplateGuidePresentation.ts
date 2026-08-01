import type {
  AssemblyTemplateReadiness,
  AssemblyTemplateReadinessStage,
  AssemblyTemplateReadinessStatus
} from './assemblyTemplateReadiness';

export type AssemblyTemplateGuideStagePresentation = {
  id: AssemblyTemplateReadinessStage;
  step: number;
  label: string;
  status: AssemblyTemplateReadinessStatus;
  statusLabel: string;
};

export type AssemblyTemplateGuidePresentation = {
  stages: AssemblyTemplateGuideStagePresentation[];
  issueCount: number;
  summaryLabel: string;
  liveMessage: string;
  catalogUnavailable: boolean;
};

const STAGES: Array<{
  id: AssemblyTemplateReadinessStage;
  step: number;
  label: string;
}> = [
  { id: 'basic', step: 1, label: '基本設定' },
  { id: 'procedure', step: 2, label: '文書・手順' },
  { id: 'areas', step: 3, label: '工程・締付' },
  { id: 'review', step: 4, label: '確認・保存' }
];

const statusLabel = (status: AssemblyTemplateReadinessStatus): string => {
  if (status === 'complete') return '完了';
  if (status === 'checking') return '確認中';
  return '未完了';
};

export function buildAssemblyTemplateGuidePresentation(
  readiness: AssemblyTemplateReadiness
): AssemblyTemplateGuidePresentation {
  const issueCount = readiness.issues.length;
  return {
    stages: STAGES.map((stage) => ({
      ...stage,
      status: readiness.stages[stage.id],
      statusLabel: statusLabel(readiness.stages[stage.id])
    })),
    issueCount,
    summaryLabel: readiness.isReady ? '保存可能' : `未完了 ${issueCount}件`,
    liveMessage: readiness.isReady
      ? '保存条件をすべて満たしました。'
      : `未完了項目が${issueCount}件あります。`,
    catalogUnavailable: readiness.issues.some(
      (issue) => issue.code === 'capability_catalog.unavailable'
    )
  };
}
