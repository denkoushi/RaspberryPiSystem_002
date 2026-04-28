import { PHOTO_TOOL_DEFAULT_CANONICAL_LABEL } from './photo-tool-label.constants.js';

/**
 * 初見（1 回目）VLM のサンプリング・プロンプト方針。
 * env の解決は呼び出し側に任せ、ここは純粋ロジックのみ（テスト容易性）。
 */
export type PhotoToolFirstPassPolicyInput = {
  strictMode: boolean;
  /** 明示指定時のみ使用。strict かつ未指定なら code 既定の低温度・短 max_tokens */
  firstPassMaxTokens?: number;
  firstPassTemperature?: number;
  inferenceMaxTokens: number;
  inferenceTemperature: number;
};

/** strict 時の既定（env 未指定時）。長文・説明文混入を抑える */
export const FIRST_PASS_STRICT_DEFAULT_MAX_TOKENS = 24;
export const FIRST_PASS_STRICT_DEFAULT_TEMPERATURE = 0.05;

const FIRST_PASS_STRICT_RULES = `【回答ルール】工場で貸し出す「工具」の名称を1語だけ返すこと。部品名（ボルト・ナット・ワッシャ・パイプ等）や材料名は避ける。工具と断定できない場合は「${PHOTO_TOOL_DEFAULT_CANONICAL_LABEL}」のみを返す。説明文・理由・句読点は禁止。`;

export function resolveFirstPassSampling(input: PhotoToolFirstPassPolicyInput): {
  maxTokens: number;
  temperature: number;
} {
  if (input.strictMode) {
    return {
      maxTokens: input.firstPassMaxTokens ?? FIRST_PASS_STRICT_DEFAULT_MAX_TOKENS,
      temperature: input.firstPassTemperature ?? FIRST_PASS_STRICT_DEFAULT_TEMPERATURE,
    };
  }
  return {
    maxTokens: input.firstPassMaxTokens ?? input.inferenceMaxTokens,
    temperature: input.firstPassTemperature ?? input.inferenceTemperature,
  };
}

export function augmentUserTextForFirstPass(
  baseUserText: string,
  input: Pick<PhotoToolFirstPassPolicyInput, 'strictMode'>
): string {
  if (!input.strictMode) {
    return baseUserText;
  }
  return `${baseUserText}\n\n${FIRST_PASS_STRICT_RULES}`;
}

export function shouldUseStrictFirstPassNormalization(
  input: Pick<PhotoToolFirstPassPolicyInput, 'strictMode'>
): boolean {
  return input.strictMode;
}
