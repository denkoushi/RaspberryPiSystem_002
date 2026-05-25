import type { DgxPolicyModeApi } from '../../../api/dgx-resource.types';

export type DgxPolicyProfileUi = {
  mode: DgxPolicyModeApi;
  titleShort: string;
  titleFull: string;
  description: string;
};

/** 表示・運用説明の単一ソース（UI はラベルを直書きしない） */
export const DGX_POLICY_PROFILES: Record<DgxPolicyModeApi, DgxPolicyProfileUi> = {
  business_first: {
    mode: 'business_first',
    titleShort: '業務優先',
    titleFull: '業務優先（LocalLLM / VLM を最優先）',
    description:
      '写真ラベル・要約・管理チャットなど本番推論を優先。私用ワークロードは運用側で抑制する前提です。',
  },
  private_ok: {
    mode: 'private_ok',
    titleShort: '私用OK',
    titleFull: '私用OK（ComfyUI 向けに業務 LLM を退避）',
    description:
      'ComfyUI 等の私用ワークロード向けに業務 LLM を停止して Spark メモリを空けます。終了後は業務優先へ戻して Ready 完了を確認してください。',
  },
  experiment_first: {
    mode: 'experiment_first',
    titleShort: '実験優先',
    titleFull: '実験優先（lab / コンテナ検証寄り）',
    description:
      '実験コンテナや検証用ランタイムにリソースを寄せやすくする運用モードです。業務 Inference への影響は人手で確認してください。',
  },
};

export function orderProfilesForUi(): DgxPolicyProfileUi[] {
  return [
    DGX_POLICY_PROFILES.business_first,
    DGX_POLICY_PROFILES.private_ok,
    DGX_POLICY_PROFILES.experiment_first,
  ];
}

/** KPI ポリシーバーの配色（日本語ラベルに依存しない） */
export function policyBarTone(mode: DgxPolicyModeApi): { barPct: number; barClass: string } {
  switch (mode) {
    case 'business_first':
      return { barPct: 100, barClass: 'bg-amber-500/90' };
    case 'private_ok':
      return { barPct: 55, barClass: 'bg-emerald-500/80' };
    case 'experiment_first':
      return { barPct: 72, barClass: 'bg-violet-500/85' };
    default: {
      const _ex: never = mode;
      return _ex;
    }
  }
}
