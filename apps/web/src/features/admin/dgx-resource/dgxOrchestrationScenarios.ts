import type { DgxOrchestrationScenarioIdApi } from '../../../api/dgx-resource.types';

export const DGX_ORCHESTRATION_SCENARIO_ORDER = [
  'private_to_business',
  'business_to_experiment',
  'experiment_to_business',
] as const satisfies readonly DgxOrchestrationScenarioIdApi[];

export type DgxOrchestrationScenarioMeta = {
  id: DgxOrchestrationScenarioIdApi;
  titleJa: string;
  descriptionJa: string;
};

export const DGX_ORCHESTRATION_SCENARIO_META: Record<DgxOrchestrationScenarioIdApi, DgxOrchestrationScenarioMeta> = {
  private_to_business: {
    id: 'private_to_business',
    titleJa: '業務に戻す',
    descriptionJa: '必要な停止試行の後、「業務優先」へ戻します。',
  },
  business_to_experiment: {
    id: 'business_to_experiment',
    titleJa: '実験を始める',
    descriptionJa: '調停後「実験優先」。業務 Inference との競合に注意してください。',
  },
  experiment_to_business: {
    id: 'experiment_to_business',
    titleJa: '実験を終えて業務に戻す',
    descriptionJa: '調停で停止試行後、「業務優先」へ戻します。',
  },
};
