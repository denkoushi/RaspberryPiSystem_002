import type { WorkloadAdjustmentStep } from './dgx-resource.policy-arbitrator.js';

/**
 * 運用モード適用後に実行するワークロード手順（順序実行）。
 * 「私用開始」など、ポリシー変更の後にならべき操作をここに閉じる。
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
  comfyRuntimeConfigured: boolean;
}): PostPolicyOrchestrationStep[] {
  const { scenarioId, comfyRuntimeConfigured } = args;
  if (scenarioId !== 'business_to_private' || !comfyRuntimeConfigured) {
    return [];
  }
  return [
    {
      targetId: 'private-comfyui',
      action: 'start',
      eventMessageJa:
        'ガイド「私用を始める」: 私用 ComfyUI 起動リクエストを送信しました（設定済み POST hook）',
      summaryJa: 'private-comfyui: 起動リクエスト（Pi5 POST）',
    },
  ];
}
