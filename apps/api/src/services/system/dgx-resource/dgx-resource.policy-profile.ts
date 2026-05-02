import type { DgxPolicyMode } from './dgx-resource.policy-store.js';

/** 運用プロファイル（ビジネス / 私用 / 実験）— 表示・ヒント用。GPU を強制しない（DgxPolicyMode の意味付け）。 */

export function policyLabelJa(mode: DgxPolicyMode): string {
  switch (mode) {
    case 'business_first':
      return '業務優先';
    case 'private_ok':
      return '私用OK';
    case 'experiment_first':
      return '実験優先';
    default: {
      const _x: never = mode;
      return _x;
    }
  }
}

export function setPolicyEventMessage(mode: DgxPolicyMode): string {
  switch (mode) {
    case 'business_first':
      return '業務優先モードに変更しました';
    case 'private_ok':
      return '私用OKモードに変更しました';
    case 'experiment_first':
      return '実験優先モードに変更しました';
    default: {
      const _x: never = mode;
      return _x;
    }
  }
}

/** 業務優先ヒント（Comfyや私用GPU抑制の表示）を出すか */
export function isBusinessFirstSuppressionHintActive(mode: DgxPolicyMode): boolean {
  return mode === 'business_first';
}

/** Comfy カードに policy バッジ（業務優先で未疎通など） */
export function comfyPolicyBadgeApplicable(mode: DgxPolicyMode, comfyConfigured: boolean, comfyReachable: boolean): boolean {
  return comfyConfigured && !comfyReachable && mode === 'business_first';
}
