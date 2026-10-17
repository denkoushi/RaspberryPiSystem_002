import type { WorkloadAdjustmentStep } from './dgx-resource.policy-arbitrator.js';

/**
 * 運用モード適用後に実行するワークロード手順（順序実行）。
 * 「実験開始」など、ポリシー変更の後にならべき操作をここに閉じる。
 *
 * targetId は事前調停（WorkloadAdjustmentStep）と同じ許容集合のみ（プレビュー型との整合）。
 */
export type PostPolicyOrchestrationStep = {
  targetId: WorkloadAdjustmentStep['targetId'];
  action: WorkloadAdjustmentStep['action'];
  eventMessageJa: string;
  /** プレビュー（ScenarioStepPreview）用の短文 */
  summaryJa: string;
};

export function buildPostPolicyOrchestrationSteps(args: {
  /** orchestration の scenario ID（プランナーとは循環しないよう literal で受ける） */
  scenarioId: string;
  experimentLabRuntimeConfigured: boolean;
}): PostPolicyOrchestrationStep[] {
  const { scenarioId, experimentLabRuntimeConfigured } = args;
  if (scenarioId === 'business_to_experiment' && experimentLabRuntimeConfigured) {
    return [
      {
        targetId: 'experiment-lab',
        action: 'start',
        eventMessageJa:
          'ガイド「実験へ切替」: experiment-lab 起動リクエストを送信しました（設定済み POST hook）',
        summaryJa: 'experiment-lab: 起動リクエスト（Pi5 POST）',
      },
    ];
  }
  return [];
}
