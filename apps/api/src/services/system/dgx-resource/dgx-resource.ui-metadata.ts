import type { DgxPolicyMode } from './dgx-resource.policy-store.js';
import { DGX_ORCHESTRATION_SCENARIO_IDS, type DgxOrchestrationScenarioId } from './dgx-resource.scenario-planner.js';

/** シナリオ表示メタデータ（Web dgxOrchestrationScenarios.ts と同一文言） */
export type DgxUiScenarioMetadata = {
  id: DgxOrchestrationScenarioId;
  titleJa: string;
  descriptionJa: string;
  cautionsJa: string[];
};

/** 運用モード表示メタデータ（Web dgxResourceProfiles.ts と同一文言） */
export type DgxUiPolicyModeMetadata = {
  mode: DgxPolicyMode;
  labelJa: string;
  titleFullJa: string;
  descriptionJa: string;
  /** policy-arbitrator が applyWorkloadChanges 時に行う調停の説明 */
  autoArbitrationNotesJa: string[];
};

export type DgxResourceUiMetadata = {
  scenarios: DgxUiScenarioMetadata[];
  policyModes: DgxUiPolicyModeMetadata[];
};

const DGX_UI_SCENARIO_BY_ID: Record<DgxOrchestrationScenarioId, Omit<DgxUiScenarioMetadata, 'id'>> = {
  private_to_business: {
    titleJa: '業務に戻す',
    descriptionJa: '必要な停止試行の後、「業務優先」へ戻します。',
    cautionsJa: ['停止中の業務 LLM を再度 ready まで起動します。'],
  },
  business_to_experiment: {
    titleJa: '実験を始める',
    descriptionJa: '調停後「実験優先」。業務 Inference との競合に注意してください。',
    cautionsJa: ['gateway と GPU を共有します。途中失敗時はイベントログを確認してください。'],
  },
  experiment_to_business: {
    titleJa: '実験を終えて業務に戻す',
    descriptionJa: '調停で停止試行後、「業務優先」へ戻します。',
    cautionsJa: [
      '実験用コンテナ自体の停止は環境側 hook の責務です。',
      'gateway と GPU を共有します。途中失敗時はイベントログを確認してください。',
    ],
  },
};

const DGX_UI_POLICY_BY_MODE: Record<DgxPolicyMode, Omit<DgxUiPolicyModeMetadata, 'mode'>> = {
  business_first: {
    labelJa: '業務優先',
    titleFullJa: '業務優先（LocalLLM / VLM を最優先）',
    descriptionJa:
      '写真ラベル・要約・管理チャットなど本番推論を優先。私用ワークロードは運用側で抑制する前提です。',
    autoArbitrationNotesJa: [
      'experiment-lab / agent-container の停止リクエストを順に送信します（Pi5 POST が設定されている場合のみ）。',
    ],
  },
  private_ok: {
    labelJa: '私用OK',
    titleFullJa: '私用OK（運用モードのみ）',
    descriptionJa:
      '運用モードのみを記録します。ワークロードの起動・停止は行いません。',
    autoArbitrationNotesJa: [
      'ワークロードの起動・停止は行いません。',
    ],
  },
  experiment_first: {
    labelJa: '実験優先',
    titleFullJa: '実験優先（lab / コンテナ検証寄り）',
    descriptionJa:
      '実験コンテナや検証用ランタイムにリソースを寄せやすくする運用モードです。業務 Inference への影響は人手で確認してください。',
    autoArbitrationNotesJa: [
      '業務 gateway は自動停止しません。',
    ],
  },
};

/** overview.uiMetadata の正本（表示文言は Web ローカル fallback と同一） */
export function buildDgxResourceUiMetadata(): DgxResourceUiMetadata {
  return {
    scenarios: DGX_ORCHESTRATION_SCENARIO_IDS.map((id) => ({
      id,
      ...DGX_UI_SCENARIO_BY_ID[id],
    })),
    policyModes: (['business_first', 'private_ok', 'experiment_first'] as const satisfies readonly DgxPolicyMode[]).map(
      (mode) => ({
        mode,
        ...DGX_UI_POLICY_BY_MODE[mode],
      })
    ),
  };
}
