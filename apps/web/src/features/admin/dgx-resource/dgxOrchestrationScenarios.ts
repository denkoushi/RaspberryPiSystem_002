import type { DgxOrchestrationScenarioIdApi } from '../../../api/dgx-resource.types';

export const DGX_ORCHESTRATION_SCENARIO_ORDER = [
  'business_to_private',
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
  business_to_private: {
    id: 'business_to_private',
    titleJa: '業務 → 私用OK',
    descriptionJa: 'モードのみ「私用OK」へ。Comfy は自動停止しません。',
  },
  private_to_business: {
    id: 'private_to_business',
    titleJa: '私用 → 業務優先',
    descriptionJa: '必要ならワークロード調停（POST）の後、「業務優先」へ。',
  },
  business_to_experiment: {
    id: 'business_to_experiment',
    titleJa: '業務 → 実験優先',
    descriptionJa: '実験用に GPU を寄せます。競合には注意してください。',
  },
  experiment_to_business: {
    id: 'experiment_to_business',
    titleJa: '実験 → 業務優先へ戻す',
    descriptionJa: '調停により停止試行後、「業務優先」へ戻します。',
  },
};
