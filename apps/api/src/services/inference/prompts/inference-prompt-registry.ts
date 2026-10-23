import { env } from '../../../config/env.js';

/** 写真持出 VLM: ユーザープロンプト既定 */
export const PHOTO_LABEL_USER_PROMPT_DEFAULT =
  '画像の中で最も目立つ工具を1つだけ選び、日本語の短い工具名だけを答えてください。説明文や句読点は不要です。';

/** 要領書要約: システムプロンプト既定 */
export const DOCUMENT_SUMMARY_SYSTEM_PROMPT_DEFAULT =
  'あなたは製造現場の要領書・手順書の要約アシスタントです。与えられたOCRテキストのみを根拠に、日本語で簡潔な要約を1段落で出力してください。' +
  '数値・記号・固有名詞は可能な限り原文どおり残してください。推測で情報を追加しないでください。' +
  '出力は要約本文のみ（見出しや箇条書きラベルは不要）。';

/** 用途別デフォルトプロンプト（参照用レジストリ） */
export const INFERENCE_PROMPT_DEFAULTS = {
  photoLabelUserPrompt: PHOTO_LABEL_USER_PROMPT_DEFAULT,
  documentSummarySystemPrompt: DOCUMENT_SUMMARY_SYSTEM_PROMPT_DEFAULT,
} as const;

/** 写真持出 VLM ユーザープロンプト（env.PHOTO_TOOL_LABEL_USER_PROMPT で上書き可） */
export function resolvePhotoLabelUserPrompt(): string {
  return env.PHOTO_TOOL_LABEL_USER_PROMPT?.trim() || INFERENCE_PROMPT_DEFAULTS.photoLabelUserPrompt;
}

/** 要領書要約システムプロンプト（env.INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT で上書き可） */
export function resolveDocumentSummarySystemPrompt(): string {
  return (
    env.INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT?.trim() ||
    INFERENCE_PROMPT_DEFAULTS.documentSummarySystemPrompt
  );
}
